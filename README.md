# luci-app-dashboard

<div align="center">

![OpenWrt](https://img.shields.io/badge/OpenWrt-21.02%20%7C%2022.03%20%7C%2023.05%20%7C%20SNAPSHOT-blue?logo=openwrt&logoColor=white)
![ImmortalWrt](https://img.shields.io/badge/ImmortalWrt-Compatible-brightgreen?logo=router&logoColor=white)
![Architecture](https://img.shields.io/badge/Arch-all%20(No%20C%20compilation)-orange)
![Package Size](https://img.shields.io/badge/IPK%20Size-~21%20KB-success)
![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)
![i18n](https://img.shields.io/badge/i18n-English%20%7C%20Ti%E1%BA%BFng%20Vi%E1%BB%87t-yellow)

**Next-Gen Realtime NOC Wall Dashboard for OpenWrt LuCI**

*Ultra-lightweight • Cyberpunk NOC aesthetic • Zero-CDN offline-first • < 3% CPU overhead*

[English](#english) • [Tiếng Việt](#tiếng-việt) • [Installation](#-installation--quick-start) • [Architecture](#-architecture) • [Screenshots](#-preview--layout)

</div>

---

<a name="english"></a>
## 🌟 Overview

**`luci-app-dashboard`** is a modern, high-performance monitoring dashboard for OpenWrt LuCI. Designed with a sleek, futuristic **NOC (Network Operations Center) Wall** dark theme, it transforms your router's LuCI interface into a mission-critical telemetry display.

Unlike traditional web-based router monitors that cause CPU spikes by executing heavy shell scripts upon every browser HTTP request, **`luci-app-dashboard`** employs an **asynchronous decoupling architecture**: a lightweight background collector daemon samples hardware telemetry every 5 seconds into RAM cache (`/tmp/dashboard/*.json`), while LuCI ubus RPC calls perform instantaneous, zero-cost memory reads.

---

## ✨ Key Features

- 🖥️ **Futuristic NOC Wall Dark Theme**
  - Cyberpunk-inspired palette: `#0B1220` deep midnight backdrop, `#121B2E` panels, accented with cyan (`#22D3EE`), amber (`#F5A524`), and emerald green (`#3DDC84`).
  - Completely scoped CSS (`.dashboard-noc`) to guarantee zero style bleeding into OpenWrt LuCI themes (Argon, Bootstrap, Material).
  - Uses native system typography stacks (`ui-sans-serif`, `ui-monospace`) with zero external web fonts.

- 📈 **Real-Time Traffic Waveform & Telemetry**
  - Live upload & download throughput gauges with automated human-readable unit scaling (bps, Kbps, Mbps, Gbps).
  - 60-point historical ring buffer rendered via embedded vector SVG sparklines.
  - Zero heavy external charting dependencies (no Chart.js or D3 download needed).

- ⚡ **Asynchronous Background Collector (`dashboardd`)**
  - Managed by OpenWrt `procd` with auto-respawn and atomic cache writing (`write .tmp → mv`).
  - Less than **3% CPU overhead** on low-power dual-core SoC architectures (e.g., MediaTek MT7981, Qualcomm IPQ, Rockchip, x86).

- 🎛️ **Comprehensive Hardware Gauges**
  - **CPU Utilization**: Live percentage, individual core count, and 1m / 5m / 15m load averages.
  - **Memory (RAM)**: Real-time visual progress bar tracking Used, Free, and Total system memory.
  - **Storage**: Overlay filesystem `/overlay` partition capacity and utilization.
  - **SoC Thermals**: Dynamic multi-zone thermal sensor detection (`/sys/class/thermal`) with hot-state warning badges.

- 🔍 **Interactive htop-Style Process Inspector**
  - Live process table displaying PID, process name, %CPU, and RSS memory usage.
  - Approximate socket-mapped network bandwidth tracking (`≈` indicator).
  - Instant client-side search filtering and multi-column sorting (Sort by Memory, CPU, or Bandwidth).

- 👥 **Client & Bandwidth Tracker**
  - Real-time LAN client discovery combining DHCP leases (`/tmp/dhcp.leases`) and ARP neighbor cache (`ip neigh`).
  - Shows Hostname, IPv4 address, MAC address, active RX/TX rates, and total cumulative transfer.
  - Automatic, seamless integration with `nlbwmon` if installed on the system.

- 🔌 **Physical Port Matrix (DSA)**
  - Native support for Linux Distributed Switch Architecture (DSA: `lan1`, `lan2`, `wan`, etc.).
  - Real-time link status (UP/DOWN carrier indicator), negotiated speed (10/100/1000/2500M), and duplex mode via `ethtool`.
  - Live per-port RX/TX bandwidth metrics and lifetime packet volume counters.

- 🌐 **100% Offline-First & Multilingual**
  - **Zero external CDN dependencies**: works reliably on isolated routers without active WAN connections.
  - Full gettext localization support: English and Tiếng Việt (Vietnamese).

---

## 🖼️ Preview & Layout

The dashboard is organized into 5 structured panels:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STATUS > DASHBOARD   [ NOC WALL LIVE ]        Kernel: 5.15   Uptime: 4d 12h │
├───────────────┬────────────────┬──────────────────────────────┬──────────────┤
│ CPU: 14.2%    │ RAM: 42.1%     │ STORAGE (/overlay): 18.5%    │ TEMP: 48.0°C │
│ [ 4 Cores ]   │ [ 215M / 512M] │ [ 1.2G / 6.5G ]              │ [ NORMAL ]   │
├───────────────┴────────────────┴──────────────────────────────┴──────────────┤
│  WAN TRAFFIC MONITOR (REALTIME)                                              │
│  ▼ RX: 54.20 Mbps (Total: 48.2 GB)    ▲ TX: 12.80 Mbps (Total: 8.4 GB)       │
│  [~~~~~~~~~~~~~~~~~~ 60s SVG Sparkline Waveform Buffer ~~~~~~~~~~~~~~~~~~~~] │
├──────────────────────────────────────────────┬───────────────────────────────┤
│  PROCESS INSPECTOR (HTOP STYLE)              │  ACTIVE CLIENTS MONITOR       │
│  [ Search... ] [Sort: MEM | CPU | NET]       │  192.168.1.15  iPhone-15      │
│  PID 2410 transmission-daemon  3.8%  38.2 MB │  192.168.1.20  NAS-Storage    │
│  PID 1102 uhttpd               0.5%   4.1 MB │  192.168.1.45  MacBook-Pro    │
├──────────────────────────────────────────────┴───────────────────────────────┤
│  PHYSICAL PORT MATRIX (DSA)                                                  │
│  [WAN] 1000M Full (UP)  |  [LAN1] 1000M Full (UP)  |  [LAN2] 100M Full (UP)  │
│  [LAN3] NO LINK (DOWN)  |  [LAN4] NO LINK (DOWN)                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Installation & Quick Start

### Method 1: Pre-built IPK Installation (Recommended)

1. Download the latest release `.ipk` package from the [GitHub Releases](https://github.com/) page:
   ```sh
   # Example: Download directly to your router /tmp directory
   wget -O /tmp/luci-app-dashboard_1.0-1_all.ipk https://github.com/<your-username>/<your-repo>/releases/latest/download/luci-app-dashboard_1.0-1_all.ipk
   ```

2. Install dependencies and the package using `opkg`:
   ```sh
   opkg update
   opkg install rpcd ubus jsonfilter ethtool
   opkg install /tmp/luci-app-dashboard_1.0-1_all.ipk
   ```

3. Restart services and flush LuCI index cache:
   ```sh
   /etc/init.d/dashboardd enable
   /etc/init.d/dashboardd restart
   /etc/init.d/rpcd restart
   rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache*
   ```

4. Open your browser and navigate to: **LuCI → Status → Dashboard**.

---

### Method 2: Standalone Local Build (Without full OpenWrt SDK)

This repository includes a standalone builder script that packages the IPK with standard GNU tar format and strict POSIX compliance:

```sh
# Clone repository
git clone https://github.com/<your-username>/luci-app-dashboard.git
cd luci-app-dashboard

# Clean and compile IPK
make package/luci-app-dashboard/compile V=s
```

The output IPK package will be generated at:
`bin/packages/luci-app-dashboard_1.0-1_all.ipk` (~21 KB).

---

### Method 3: Integrating into OpenWrt Buildroot / SDK

1. Add this repository into your OpenWrt buildroot:
   ```sh
   cd openwrt
   git clone https://github.com/<your-username>/luci-app-dashboard.git package/luci-app-dashboard
   ```

2. Configure in `menuconfig`:
   ```sh
   make menuconfig
   # Navigate to: LuCI -> 3. Applications -> luci-app-dashboard
   # Mark with [*] (built-in) or [M] (module)
   ```

3. Compile the package:
   ```sh
   make package/luci-app-dashboard/compile V=s
   ```

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│               LuCI Frontend (Browser)                 │
│         /www/luci-static/resources/view/dashboard.js   │
│         /www/luci-static/resources/dashboard.css       │
└───────────────────────────▲────────────────────────────┘
                            │
               ubus / JSON-RPC (HTTP Polling: 5s)
                            │
┌───────────────────────────▼────────────────────────────┐
│                    rpcd Daemon                         │
│           /usr/libexec/rpcd/luci.dashboard             │
│       ACL: /usr/share/rpcd/acl.d/luci-app-dashboard    │
└───────────────────────────▲────────────────────────────┘
                            │
                 Instant Reads from Memory
                            │
┌───────────────────────────▼────────────────────────────┐
│              RAM Cache: /tmp/dashboard/*.json          │
│   system.json | traffic.json | processes.json | ...    │
└───────────────────────────▲────────────────────────────┘
                            │
                 Atomic Write (.tmp -> mv)
                            │
┌───────────────────────────┴────────────────────────────┐
│           procd Service: dashboardd                   │
│         /usr/libexec/dashboard-collector.sh            │
│       Sampling /proc, /sys, ethtool every 5 seconds     │
└────────────────────────────────────────────────────────┘
```

### ubus API Methods (`luci.dashboard`)

| Method | Parameters | Description |
| :--- | :--- | :--- |
| `system_info` | *none* | Hostname, model, build, uptime, CPU %, load, RAM, disk, temperature |
| `traffic` | *none* | Current WAN rx/tx bps, lifetime byte counters, 60-sample historical buffer |
| `processes` | `limit` *(int)*, `sort` *(string: "mem"\|"cpu"\|"net")* | Top processes with PID, name, %CPU, RSS memory, approx socket traffic |
| `clients` | *none* | Active LAN devices with hostname, IP, MAC, live bandwidth, and total traffic |
| `ports` | *none* | Physical Ethernet interfaces, carrier status, link speed, and I/O metrics |

You can test RPC methods directly from SSH:
```sh
ubus call luci.dashboard system_info
ubus call luci.dashboard traffic
ubus call luci.dashboard processes '{"limit": 10, "sort": "cpu"}'
ubus call luci.dashboard clients
ubus call luci.dashboard ports
```

---

## 📁 Repository Structure

```
luci-app-dashboard/
├── Makefile                                    # OpenWrt Buildroot & standalone Makefile
├── root/
│   ├── etc/init.d/dashboardd                   # procd service managing the background collector
│   ├── usr/libexec/
│   │   ├── dashboard-collector.sh              # Asynchronous data collector (5s interval)
│   │   └── rpcd/luci.dashboard                 # ubus RPC provider for LuCI
│   └── usr/share/
│       ├── luci/menu.d/luci-app-dashboard.json # LuCI navigation menu entry (Status -> Dashboard)
│       └── rpcd/acl.d/luci-app-dashboard.json  # rpcd access permissions
├── htdocs/www/luci-static/resources/
│   ├── view/dashboard.js                       # LuCI client-side JavaScript view
│   └── dashboard/dashboard.css                 # NOC Wall scoped stylesheet
├── po/
│   ├── templates/dashboard.pot                 # Gettext translation template
│   └── vi/dashboard.po                         # Vietnamese translation
└── scripts/
    └── build_ipk.py                            # POSIX GNU tar compliant IPK packager
```

---

## 🛠️ Diagnostics & Troubleshooting

1. **Dashboard menu does not appear under `Status`:**
   Clear LuCI's cache files and restart `rpcd`:
   ```sh
   rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache*
   /etc/init.d/rpcd restart
   ```

2. **No telemetry data or blank panels:**
   Check whether the collector daemon is running:
   ```sh
   /etc/init.d/dashboardd status
   # Check logs:
   logread | grep dashboardd
   # Check if cache files are updating:
   ls -la /tmp/dashboard/
   ```

3. **Port matrix shows empty:**
   Ensure `ethtool` is installed:
   ```sh
   opkg update && opkg install ethtool
   ```

---

<a name="tiếng-việt"></a>
## 🇻🇳 Hướng Dẫn Tiếng Việt

### Giới Thiệu
**`luci-app-dashboard`** là gói giao diện giám sát thời gian thực cao cấp dành cho OpenWrt LuCI, được thiết kế theo phong cách **NOC Wall** (Trung tâm điều hành mạng) hiện đại và chuyên nghiệp.

### Điểm Vượt Trội
- **Kiến trúc bất đồng bộ không gây nghẽn CPU:** Router cấu hình yếu không bị đơ giật do request ubus chỉ đọc cache JSON từ RAM (`/tmp/dashboard/*.json`), dữ liệu được thu thập nền mỗi 5 giây bởi daemon `dashboardd`.
- **100% Hoạt động độc lập (Offline-first):** Không tải bất kỳ thư viện hay font nào từ CDN bên ngoài (Google Fonts, cdnjs), router không có internet vẫn hiển thị đầy đủ 100%.
- **Biểu đồ sóng SVG siêu nhẹ:** Hiển thị lưu lượng tải lên/xuống mượt mà với bộ đệm lịch sử 60 giây, không phụ thuộc thư viện đồ thị nặng.
- **Bảng tiến trình kiểu `htop`:** Xem tiến trình theo thời gian thực, hỗ trợ tìm kiếm và sắp xếp theo RAM, CPU, băng thông mạng.
- **Theo dõi thiết bị mạng (Clients):** Nhận diện hostname, IP, MAC và lưu lượng tiêu thụ của từng thiết bị trong mạng LAN (tự động tích hợp `nlbwmon` nếu có).
- **Trạng thái cổng mạng vật lý (DSA):** Hiển thị trực quan trạng thái cắm dây, tốc độ đồng bộ (10/100/1000/2500 Mbps, Full/Half Duplex) và băng thông từng cổng LAN/WAN.

### Cài Đặt Nhanh

```sh
# 1. Cài đặt các gói phụ thuộc cần thiết
opkg update
opkg install rpcd ubus jsonfilter ethtool

# 2. Tải và cài đặt gói IPK
wget -O /tmp/luci-app-dashboard_1.0-1_all.ipk <link_tai_file_ipk>
opkg install /tmp/luci-app-dashboard_1.0-1_all.ipk

# 3. Kích hoạt dịch vụ và làm mới giao diện LuCI
/etc/init.d/dashboardd enable
/etc/init.d/dashboardd restart
/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache*
```

Truy cập trên trình duyệt: **Trạng thái → Bảng điều khiển (Status → Dashboard)**.

---

## 📋 System Requirements

| Component | Minimum Requirement | Notes |
| :--- | :--- | :--- |
| **OpenWrt** | ≥ 21.02 (DSA architecture recommended) | Compatible with 22.03, 23.05, SNAPSHOT & ImmortalWrt |
| **Architecture** | All (`all`) | Architecture independent (MIPS, ARM, ARM64, x86_64, RISC-V) |
| **Free Flash** | ~150 KB | Package size: ~21 KB, installed: ~92 KB |
| **RAM** | ≥ 64 MB | Temporary cache footprint is < 100 KB in `/tmp` |
| **Dependencies** | `rpcd`, `ubus`, `jsonfilter`, `ethtool` | Standard OpenWrt core utilities |
| **Optional** | `nlbwmon` | Enhances per-client cumulative traffic measurement |

---

## 🤝 Contributing

Contributions, bug reports, and feature proposals are welcome!
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

Made with ❤️ for the **OpenWrt & Networking Community**

</div>
