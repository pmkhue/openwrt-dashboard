#!/usr/bin/env python3
"""
build_ipk.py - Build a standard OpenWrt IPK package compatible with BusyBox opkg/tar.

BusyBox tar fails with:
  get_header_tar: Unknown typeflag: 0x78
when archives contain POSIX PAX extended headers (typeflag 'x' = 0x78) or AppleDouble (._*) files.
This script generates an IPK with:
1. GNU tar format with no pax headers (pax_headers = {})
2. Standard IPK layout:
   - ./debian-binary (contains "2.0\\n")
   - ./control.tar.gz (control, postinst, prerm, postrm)
   - ./data.tar.gz (filesystem tree rooted at ./)
3. uid=0, gid=0, root:root ownership for all entries
"""

import os
import io
import sys
import gzip
import tarfile
import re

PKG_NAME = "luci-app-dashboard"
PKG_VERSION = "1.0-1"
PKG_ARCH = "all"
PKG_TITLE = "Realtime status dashboard (NOC style)"
PKG_DEPENDS = "rpcd, ubus, jsonfilter, ethtool"

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def create_tarinfo(name, size=0, is_dir=False, mode=0o644, mtime=1700000000):
    ti = tarfile.TarInfo(name=name)
    ti.size = size
    ti.type = tarfile.DIRTYPE if is_dir else tarfile.REGTYPE
    ti.mode = mode
    ti.uid = 0
    ti.gid = 0
    ti.uname = "root"
    ti.gname = "root"
    ti.mtime = mtime
    ti.pax_headers = {}
    return ti

def parse_po_to_json(po_path):
    """Simple parser for gettext .po file to JSON dict for LuCI JS"""
    translations = {}
    if not os.path.isfile(po_path):
        return translations
    with open(po_path, 'r', encoding='utf-8') as f:
        content = f.read()

    pairs = re.findall(r'msgid\s+"(.*)"\s*\nmsgstr\s+"(.*)"', content)
    for msgid, msgstr in pairs:
        if msgid and msgstr:
            translations[msgid] = msgstr
    return translations

def build_data_tar():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        added_dirs = set()

        def add_directory(dirpath):
            norm = os.path.normpath(dirpath)
            if not norm.startswith("./"):
                norm = "./" + norm.lstrip("/")
            if norm == "." or norm == "./" or norm in added_dirs:
                return
            parent = os.path.dirname(norm)
            if parent and parent != "." and parent != "./":
                add_directory(parent)
            ti = create_tarinfo(name=norm, is_dir=True, mode=0o755)
            tar.addfile(ti)
            added_dirs.add(norm)

        # 1. Add files from root/ -> /
        root_fs = os.path.join(ROOT_DIR, "root")
        for dirpath, dirnames, filenames in os.walk(root_fs):
            for fn in filenames:
                if fn == ".DS_Store" or fn.startswith("._") or fn.endswith(".tmp"):
                    continue
                full_path = os.path.join(dirpath, fn)
                rel_path = os.path.relpath(full_path, root_fs)
                target_path = "./" + rel_path

                add_directory(os.path.dirname(target_path))

                mode = 0o755 if (fn.endswith(".sh") or fn == "dashboardd" or fn == "luci.dashboard") else 0o644
                with open(full_path, "rb") as f:
                    data = f.read()
                ti = create_tarinfo(name=target_path, size=len(data), is_dir=False, mode=mode)
                tar.addfile(ti, io.BytesIO(data))

        # 2. Add files from htdocs/ -> /
        htdocs_fs = os.path.join(ROOT_DIR, "htdocs")
        for dirpath, dirnames, filenames in os.walk(htdocs_fs):
            for fn in filenames:
                if fn == ".DS_Store" or fn.startswith("._") or fn.endswith(".tmp"):
                    continue
                full_path = os.path.join(dirpath, fn)
                rel_path = os.path.relpath(full_path, htdocs_fs)
                target_path = "./" + rel_path

                add_directory(os.path.dirname(target_path))

                with open(full_path, "rb") as f:
                    data = f.read()
                ti = create_tarinfo(name=target_path, size=len(data), is_dir=False, mode=0o644)
                tar.addfile(ti, io.BytesIO(data))

        # 3. Add compiled vi translation json to /www/luci-static/resources/view/dashboard.vi.json
        po_path = os.path.join(ROOT_DIR, "po", "vi", "dashboard.po")
        if os.path.isfile(po_path):
            import json
            trans = parse_po_to_json(po_path)
            if trans:
                target_json = "./www/luci-static/resources/view/dashboard.vi.json"
                add_directory(os.path.dirname(target_json))
                data = json.dumps(trans, ensure_ascii=False, indent=2).encode('utf-8')
                ti = create_tarinfo(name=target_json, size=len(data), is_dir=False, mode=0o644)
                tar.addfile(ti, io.BytesIO(data))

    buf.seek(0)
    return buf.getvalue()

def build_control_tar(installed_size):
    control_content = f"""Package: {PKG_NAME}
Version: {PKG_VERSION}
Depends: {PKG_DEPENDS}
Section: luci
Architecture: {PKG_ARCH}
Maintainer: OpenWrt
Installed-Size: {installed_size}
Description: {PKG_TITLE}
""".strip().encode("utf-8") + b"\n"

    postinst_content = b"""#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
    /etc/init.d/dashboardd enable
    /etc/init.d/dashboardd start
    /etc/init.d/rpcd reload || /etc/init.d/rpcd restart
    rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache*
}
exit 0
"""

    prerm_content = b"""#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
    /etc/init.d/dashboardd stop
    /etc/init.d/dashboardd disable
}
exit 0
"""

    postrm_content = b"""#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
    rm -rf /tmp/dashboard
    /etc/init.d/rpcd reload || /etc/init.d/rpcd restart
    rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache*
}
exit 0
"""

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        # control file
        ti = create_tarinfo("./control", size=len(control_content), mode=0o644)
        tar.addfile(ti, io.BytesIO(control_content))

        # postinst
        ti = create_tarinfo("./postinst", size=len(postinst_content), mode=0o755)
        tar.addfile(ti, io.BytesIO(postinst_content))

        # prerm
        ti = create_tarinfo("./prerm", size=len(prerm_content), mode=0o755)
        tar.addfile(ti, io.BytesIO(prerm_content))

        # postrm
        ti = create_tarinfo("./postrm", size=len(postrm_content), mode=0o755)
        tar.addfile(ti, io.BytesIO(postrm_content))

    buf.seek(0)
    return buf.getvalue()

def build_ipk(output_path):
    print("Packing data.tar.gz...")
    data_tar_gz = build_data_tar()
    # Uncompressed size of data
    installed_size = len(gzip.decompress(data_tar_gz))

    print(f"Packing control.tar.gz (installed-size: {installed_size})...")
    control_tar_gz = build_control_tar(installed_size)

    debian_binary = b"2.0\n"

    print(f"Assembling final IPK: {output_path}...")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with tarfile.open(output_path, mode="w:gz", format=tarfile.GNU_FORMAT) as ipk:
        # 1. debian-binary
        ti = create_tarinfo("./debian-binary", size=len(debian_binary), mode=0o644)
        ipk.addfile(ti, io.BytesIO(debian_binary))

        # 2. data.tar.gz
        ti = create_tarinfo("./data.tar.gz", size=len(data_tar_gz), mode=0o644)
        ipk.addfile(ti, io.BytesIO(data_tar_gz))

        # 3. control.tar.gz
        ti = create_tarinfo("./control.tar.gz", size=len(control_tar_gz), mode=0o644)
        ipk.addfile(ti, io.BytesIO(control_tar_gz))

    print("IPK package successfully built!")

if __name__ == "__main__":
    out_dir = os.path.join(ROOT_DIR, "bin", "packages")
    out_file = os.path.join(out_dir, f"{PKG_NAME}_{PKG_VERSION}_{PKG_ARCH}.ipk")
    build_ipk(out_file)
