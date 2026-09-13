#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

ifneq ($(wildcard $(TOPDIR)/rules.mk),)
# Standard OpenWrt buildroot integration
include $(TOPDIR)/rules.mk

LUCI_TITLE:=Realtime status dashboard (NOC style)
LUCI_DEPENDS:=+rpcd +ubus +jsonfilter +ethtool
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-dashboard
PKG_VERSION:=1.0
PKG_RELEASE:=1

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

else
# Standalone mode: allows build testing directly on dev machine
PKG_NAME:=luci-app-dashboard
PKG_VERSION:=1.0
PKG_RELEASE:=1
PKG_ARCH:=all

all: compile

package/$(PKG_NAME)/clean clean:
	@echo "=== Cleaning $(PKG_NAME) ==="
	@rm -rf bin build_dir

package/$(PKG_NAME)/compile compile: package/$(PKG_NAME)/clean
	@echo "=== Compiling and validating $(PKG_NAME) (v$(PKG_VERSION)-$(PKG_RELEASE)) ==="
	@echo "--> Checking shell scripts syntax (BusyBox ash / POSIX sh compliance)..."
	@sh -n root/usr/libexec/dashboard-collector.sh
	@sh -n root/usr/libexec/rpcd/luci.dashboard
	@sh -n root/etc/init.d/dashboardd
	@echo "--> Checking JavaScript syntax..."
	@node -c htdocs/www/luci-static/resources/view/dashboard.js
	@echo "--> Validating JSON ACL and Menu files..."
	@python3 -c 'import json; json.load(open("root/usr/share/rpcd/acl.d/luci-app-dashboard.json")); json.load(open("root/usr/share/luci/menu.d/luci-app-dashboard.json"))'
	@echo "--> Building IPK package archive..."
	@python3 scripts/build_ipk.py
	@echo "=== Build succeeded! Output: bin/packages/$(PKG_NAME)_$(PKG_VERSION)-$(PKG_RELEASE)_$(PKG_ARCH).ipk ==="

.PHONY: all clean compile package/$(PKG_NAME)/clean package/$(PKG_NAME)/compile
endif
