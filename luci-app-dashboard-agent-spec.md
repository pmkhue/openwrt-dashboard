# Spec triển khai: `luci-app-dashboard` (giao diện NOC Wall)

> Tài liệu này viết để đưa thẳng cho một AI coding agent (Claude Code, v.v.) chạy trong một
> checkout OpenWrt SDK / feed riêng. Agent nên làm lần lượt theo từng **Task**, mỗi Task xong thì
> build thử (`make package/luci-app-dashboard/compile V=s`) trước khi qua Task kế tiếp.

## 0. Mục tiêu

Xây gói LuCI `luci-app-dashboard`: 1 trang dashboard duy nhất tại `Status → Dashboard`, giao diện
tối theo phong cách "NOC Wall" (đã duyệt), cập nhật dữ liệu mỗi 5 giây, gồm 5 khối:

1. Thông tin hệ thống: CPU / RAM / Disk / Nhiệt độ / bản build
2. Traffic real-time (biểu đồ upload/download)
3. Danh sách tiến trình kiểu htop, sort theo RAM/băng thông
4. Danh sách client kèm hostname, sort theo băng thông đang dùng
5. Trạng thái từng cổng mạng: tốc độ vào/ra + tổng dung lượng

## 1. Ràng buộc quan trọng (đọc trước khi code)

- Router hạn chế RAM/CPU → **không** tính toán nặng trong mỗi request ubus. Dùng một collector
  daemon chạy nền, ghi cache ra `/tmp/dashboard/*.json`, ubus chỉ đọc cache.
- Nhiều thiết bị không có internet ổn định trên WAN khi đang cấu hình → **không** phụ thuộc CDN
  ngoài (Google Fonts, cdnjs...). Mọi JS/CSS/font phải được đóng gói (vendor) vào ipk.
- Target tối thiểu: OpenWrt ≥ 21.02 (kiến trúc mạng DSA, mỗi cổng LAN là 1 netdev riêng: `lan1`,
  `lan2`...). Không cần hỗ trợ `swconfig` cũ trừ khi bạn yêu cầu thêm.
- Băng thông theo **từng tiến trình** không có API kernel chuẩn — xem mục 5.3 (mức độ chính xác
  chấp nhận được cho v1).

## 2. Cây thư mục package

```
luci-app-dashboard/
├── Makefile
├── root/
│   ├── etc/init.d/dashboardd                          # procd service - collector nền
│   ├── usr/libexec/dashboard-collector.sh              # vòng lặp lấy mẫu 5s
│   ├── usr/libexec/rpcd/luci.dashboard                 # ubus RPC handler (đọc cache)
│   ├── usr/share/rpcd/acl.d/luci-app-dashboard.json     # quyền ubus
│   └── usr/share/luci/menu.d/luci-app-dashboard.json    # đăng ký menu
├── htdocs/www/luci-static/resources/
│   ├── view/dashboard.js                                # LuCI view chính
│   └── dashboard/
│       ├── dashboard.css                                # design tokens NOC Wall
│       └── chart.min.js                                 # Chart.js vendor (hoặc sparkline tự viết)
└── po/
    ├── vi/dashboard.po
    └── templates/dashboard.pot
```

## 3. Task 1 — Collector daemon (nguồn dữ liệu)

File `usr/libexec/dashboard-collector.sh`, chạy dưới `procd` (respawn nếu chết), vòng lặp mỗi 5s:

- **system**: đọc `/proc/stat` 2 lần cách 1s để tính CPU%; `/proc/meminfo`; `df /overlay`;
  `/sys/class/thermal/thermal_zone*/temp` (thử tuần tự các zone, bỏ qua nếu không có); build info
  qua `ubus call system board` (đừng tự parse `/etc/openwrt_release`, board đã có sẵn model/kernel).
- **traffic**: với từng interface theo dõi (mặc định `br-lan` + interface WAN đọc từ
  `ubus call network.interface.wan status`), đọc `/sys/class/net/<if>/statistics/{rx,tx}_bytes`,
  tính delta/5s ra bps. Giữ ring buffer 60 điểm gần nhất trong bộ nhớ tiến trình collector.
- **processes**: liệt kê `/proc/[pid]/stat` + `/proc/[pid]/status`, tính `%CPU` theo công thức
  top chuẩn (`(utime+stime) delta / total jiffies delta`), RSS từ `VmRSS`. Băng thông xem 5.3.
- **clients**: hợp nhất `/tmp/dhcp.leases` (hostname) với `ip neigh show` (MAC còn reachable/stale).
  Nếu có gói `nlbwmon` cài sẵn, ưu tiên lấy tổng dung lượng qua `ubus call nlbwmon` thay vì tự đếm.
- **ports**: liệt kê netdev vật lý (loại trừ `lo`, `br-lan`, các `.vlan`), lấy trạng thái link/tốc độ
  qua `ethtool <if>` (parse `Link detected`, `Speed`, `Duplex`), rx/tx bytes như traffic.

Ghi kết quả ra `/tmp/dashboard/system.json`, `traffic.json`, `processes.json`, `clients.json`,
`ports.json` — mỗi file ghi kiểu atomic (`write tmp → mv`) để rpcd không đọc phải file dở dang.

`etc/init.d/dashboardd`: procd service tiêu chuẩn, `respawn`, gọi script trên, `START=95`.

## 4. Task 2 — ubus / rpcd contract

`usr/libexec/rpcd/luci.dashboard` (shell, dùng `jsonfilter`/`ucode` để build JSON), implement 2
lệnh `list` và `call` theo giao thức rpcd chuẩn. Tên file **phải** trùng tên object ubus.

Schema trả về cho từng method (giữ đúng field name này để frontend khớp):

```jsonc
// system_info
{
  "hostname": "OpenWrt-GW01", "model": "Xiaomi AX3000T", "build": "OpenWrt 23.05.4 r24012",
  "kernel": "5.15.150", "uptime": 1234567,
  "cpu": { "percent": 34.2, "load": [0.61, 0.48, 0.39], "cores": 4 },
  "memory": { "total_kb": 524288, "used_kb": 320000, "percent": 61.0 },
  "disk": { "total_kb": 6500000, "used_kb": 1150000, "percent": 17.7 },
  "temp": { "celsius": 52.0, "available": true }
}

// traffic
{
  "rx_bps": 44380000, "tx_bps": 8500000,
  "rx_total_bytes": 2100000000000, "tx_total_bytes": 230000000000,
  "history": [ { "t": 1234560, "rx_bps": 40000000, "tx_bps": 8000000 }, ... ]  // tối đa 60 điểm
}

// processes  (params: limit:int=30, sort:"mem"|"cpu"|"net"="mem")
{ "processes": [
  { "pid": 2231, "name": "transmission-daemon", "cpu_percent": 4.2, "mem_kb": 38400,
    "net_bps": 612000, "net_approx": true }
] }

// clients
{ "clients": [
  { "mac": "AA:BB:CC:DD:EE:FF", "ip": "192.168.1.20", "hostname": "NAS-Synology",
    "rx_bps": 18400000, "tx_bps": 2100000, "total_bytes": 153000000000 }
] }

// ports
{ "ports": [
  { "name": "lan1", "label": "LAN1", "link": true, "speed_mbps": 1000, "duplex": "full",
    "rx_bps": 14100000, "tx_bps": 2200000, "rx_total_bytes": 442000000000, "tx_total_bytes": 88000000000 }
] }
```

`usr/share/rpcd/acl.d/luci-app-dashboard.json`:

```json
{
  "luci-app-dashboard": {
    "description": "Access to dashboard status data",
    "read": { "ubus": { "luci.dashboard": ["system_info","traffic","processes","clients","ports"] } }
  }
}
```

## 5. Task 3 — Menu + frontend view

`usr/share/luci/menu.d/luci-app-dashboard.json`:

```json
{ "admin/status/dashboard": {
  "title": "Dashboard", "order": 10,
  "action": { "type": "view", "path": "dashboard" },
  "depends": { "acl": ["luci-app-dashboard"] }
} }
```

`htdocs/.../view/dashboard.js` — khung chuẩn LuCI JS view:

```js
'use strict';
'require view';
'require poll';
'require rpc';

var callSystem = rpc.declare({ object: 'luci.dashboard', method: 'system_info' });
var callTraffic = rpc.declare({ object: 'luci.dashboard', method: 'traffic' });
var callProc = rpc.declare({ object: 'luci.dashboard', method: 'processes', params: ['limit','sort'] });
var callClients = rpc.declare({ object: 'luci.dashboard', method: 'clients' });
var callPorts = rpc.declare({ object: 'luci.dashboard', method: 'ports' });

return view.extend({
  load: function() {
    return Promise.all([callSystem(), callTraffic(), callProc(30,'mem'), callClients(), callPorts()]);
  },
  render: function(data) {
    this.injectAssets();          // <link> css + <script> chart.min.js, chỉ 1 lần
    var root = this.buildLayout(data); // dựng đúng cấu trúc Preview 2: header, gauge-row,
                                        // traffic-panel, two-col (process/client), ports-panel
    poll.add(L.bind(this.refresh, this), 5);
    return root;
  },
  refresh: function() {
    return Promise.all([callSystem(), callTraffic(), callProc(30,'mem'), callClients(), callPorts()])
      .then(L.bind(this.updateDOM, this)); // cập nhật tại chỗ, không render lại toàn bộ DOM
  }
});
```

### 5.1 Design tokens (lấy nguyên từ Preview 2 đã duyệt)

```css
--bg:#0B1220; --panel:#121B2E; --panel-2:#0F1728; --grid:#1E2A42; --border:#223252;
--text:#E6EDF5; --muted:#7C8BA3; --cyan:#22D3EE; --amber:#F5A524; --red:#F0555A; --green:#3DDC84;
```
Font hiển thị: `Space Grotesk` cho tiêu đề, `IBM Plex Mono` cho số liệu. **Không** load qua Google
Fonts — hoặc bundle file `.woff2` đã subset vào package, hoặc (khuyến nghị cho v1) fallback về
font hệ thống (`ui-sans-serif` / `ui-monospace`) để giữ gói nhẹ, vẫn đúng tinh thần thiết kế.

Bọc toàn bộ view trong 1 class gốc, ví dụ `.dashboard-noc { ... }`, để CSS không rò rỉ ra các
trang LuCI khác dùng theme Bootstrap mặc định.

### 5.2 Chart

Vendor `chart.min.js` (~70KB gzip bản UMD tối giản) vào package thay vì CDN. Nếu muốn gói nhẹ hơn
nữa cho thiết bị flash 4MB, thay bằng 1 hàm vẽ waveform tự viết bằng `<canvas>` (không cần thư
viện ngoài) — cân nhắc theo dung lượng flash của thiết bị mục tiêu.

### 5.3 Về cột "băng thông theo tiến trình"

Không có cách chính xác tuyệt đối mà không thêm dependency nặng. V1 đề xuất: đánh dấu
`net_approx: true` khi giá trị lấy từ ánh xạ cổng đang mở (`/proc/net/tcp`,`/proc/net/udp` →
`/proc/[pid]/fd`) thay vì đo trực tiếp; hiển thị icon "≈" cạnh số trong UI để người dùng hiểu đây
là ước lượng, không phải số đo chính xác như nethogs.

## 6. Task 4 — Packaging

`Makefile` chuẩn OpenWrt, khai báo:

```
PKG_NAME:=luci-app-dashboard
PKG_VERSION:=1.0
PKG_RELEASE:=1
LUCI_TITLE:=Realtime status dashboard (NOC style)
LUCI_DEPENDS:=+rpcd +ubus +jsonfilter +ethtool
LUCI_PKGARCH:=all
include $(TOPDIR)/feeds/luci/luci.mk
```

`nlbwmon` chỉ nên là dependency **tùy chọn** (không bắt buộc) — code phải tự phát hiện bằng
`ubus list | grep nlbwmon` và fallback nếu không có, không được để thiếu gói này làm app crash.

i18n: chuỗi tiếng Việt/Anh qua `po/vi/dashboard.po`, `po/templates/dashboard.pot`, dùng hàm
`_("...")` trong `dashboard.js` theo chuẩn LuCI.

## 7. Checklist hoàn thành cho từng task

- [ ] Task 1: `logread | grep dashboardd` không có lỗi, `/tmp/dashboard/*.json` cập nhật mỗi 5s
- [ ] Task 2: `ubus call luci.dashboard system_info` trả đúng schema mục 4
- [ ] Task 3: trang `Status → Dashboard` load được, không có lỗi console, giao diện khớp Preview 2
- [ ] Task 4: `opkg install luci-app-dashboard_*.ipk` cài sạch trên thiết bị thật/QEMU OpenWrt
- [ ] Đo CPU overhead của `dashboardd` bằng `top -d1` khi có 3 tab trình duyệt cùng mở dashboard —
      mục tiêu dưới ~3% CPU trung bình trên thiết bị MT7981

## 8. Thứ tự đề xuất cho agent

1. Task 1 (collector) → test độc lập bằng cách `cat /tmp/dashboard/*.json` sau khi chạy script tay
2. Task 2 (rpcd/ACL) → test bằng `ubus call luci.dashboard <method>`
3. Task 3 (menu + view.js + CSS, dùng dữ liệu giả lập trước nếu Task 1/2 chưa xong hẳn)
4. Nối Task 3 với dữ liệu thật từ Task 2
5. Task 4 (Makefile, build thử `make package/luci-app-dashboard/{clean,compile} V=s`)
