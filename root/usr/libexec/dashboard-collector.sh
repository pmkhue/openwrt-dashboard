#!/bin/sh
# OpenWrt Dashboard Data Collector Daemon
# Periodic collector (every 5 seconds) writing cache JSON for ubus / rpcd
# Compatible with POSIX sh and BusyBox ash

PROC_DIR="${MOCK_PROC_DIR:-/proc}"
SYS_DIR="${MOCK_SYS_DIR:-/sys}"
CACHE_DIR="${CACHE_DIR:-/tmp/dashboard}"
STATE_DIR="${CACHE_DIR}/.state"

RUN_ONCE=0
for arg in "$@"; do
	case "$arg" in
		--once) RUN_ONCE=1 ;;
	esac
done
[ -n "$RUN_ONCE_ENV" ] && RUN_ONCE="$RUN_ONCE_ENV"

# Ensure output and state directories exist
mkdir -p "$CACHE_DIR" "$STATE_DIR"

# Trap termination signals
trap 'exit 0' INT TERM

# Atomic file write: write to .tmp then mv
atomic_write() {
	target_file="$1"
	tmp_file="${target_file}.tmp.$$"
	cat > "$tmp_file" && mv "$tmp_file" "$target_file"
}

# Resolve WAN interface name
resolve_wan_if() {
	wan_name=""

	# 1. Primary check: Default route interface in /proc/net/route
	# In Linux, Destination 00000000 is the Internet default gateway
	if [ -f "$PROC_DIR/net/route" ]; then
		wan_name=$(awk '$2 == "00000000" && $1 != "lo" { print $1; exit }' "$PROC_DIR/net/route" 2>/dev/null)
	fi

	# 2. Check ip route default if route file didn't yield an interface
	if [ -z "$wan_name" ] && command -v ip >/dev/null 2>&1; then
		wan_name=$(ip route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
	fi

	# 3. Check ubus network.interface.wan status
	if [ -z "$wan_name" ] && command -v ubus >/dev/null 2>&1; then
		wan_status=$(ubus call network.interface.wan status 2>/dev/null)
		if [ -n "$wan_status" ]; then
			if command -v jsonfilter >/dev/null 2>&1; then
				wan_name=$(printf '%s' "$wan_status" | jsonfilter -e '@.l3_device' 2>/dev/null)
				[ -z "$wan_name" ] && wan_name=$(printf '%s' "$wan_status" | jsonfilter -e '@.device' 2>/dev/null)
			fi
			if [ -z "$wan_name" ]; then
				wan_name=$(printf '%s' "$wan_status" | awk '
					function get_val(str, key) {
						regex = "\"" key "\"[ \t]*:[ \t]*\"[^\"]+\"";
						if (match(str, regex)) {
							m = substr(str, RSTART, RLENGTH);
							sub(/^"[^"]+"[ \t]*:[ \t]*"/, "", m);
							sub(/"$/, "", m);
							return m;
						}
						return "";
					}
					{ str = str $0 }
					END {
						dev = get_val(str, "l3_device");
						if (dev == "") dev = get_val(str, "device");
						print dev;
					}
				')
			fi
		fi
	fi

	# 4. Check network.interface.wan6
	if [ -z "$wan_name" ] && command -v ubus >/dev/null 2>&1; then
		wan6_status=$(ubus call network.interface.wan6 status 2>/dev/null)
		if [ -n "$wan6_status" ] && command -v jsonfilter >/dev/null 2>&1; then
			wan_name=$(printf '%s' "$wan6_status" | jsonfilter -e '@.l3_device' 2>/dev/null)
			[ -z "$wan_name" ] && wan_name=$(printf '%s' "$wan6_status" | jsonfilter -e '@.device' 2>/dev/null)
		fi
	fi

	# 5. Candidate interfaces fallback
	if [ -z "$wan_name" ] || [ ! -d "$SYS_DIR/class/net/$wan_name" ]; then
		for cand in wan eth1 eth0 br-lan; do
			if [ -d "$SYS_DIR/class/net/$cand" ]; then
				wan_name="$cand"
				break
			fi
		done
	fi

	# 6. Ultimate fallback: non-loopback interface with highest traffic
	if [ -z "$wan_name" ] || [ ! -d "$SYS_DIR/class/net/$wan_name" ]; then
		max_rx=0
		for ifpath in "$SYS_DIR"/class/net/*; do
			if [ -d "$ifpath" ]; then
				iface="${ifpath##*/}"
				case "$iface" in
					lo|docker*|br-*|veth*) continue ;;
				esac
				if [ -f "$ifpath/statistics/rx_bytes" ]; then
					cur_rx=$(cat "$ifpath/statistics/rx_bytes" 2>/dev/null || echo 0)
					if [ "$cur_rx" -gt "$max_rx" ]; then
						max_rx="$cur_rx"
						wan_name="$iface"
					fi
				fi
			fi
		done
	fi

	printf '%s' "$wan_name"
}

# Collect system info
collect_system() {
	c_u1="$1" c_n1="$2" c_s1="$3" c_i1="$4" c_w1="$5" c_ir1="$6" c_so1="$7" c_st1="$8"
	c_u2="$9"
	shift 9
	c_n2="$1" c_s2="$2" c_i2="$3" c_w2="$4" c_ir2="$5" c_so2="$6" c_st2="$7"

	# Read board info via ubus call system board
	board_json=""
	if command -v ubus >/dev/null 2>&1; then
		board_json=$(ubus call system board 2>/dev/null)
	fi

	hostname=""
	model=""
	build=""
	kernel=""

	if [ -n "$board_json" ]; then
		if command -v jsonfilter >/dev/null 2>&1; then
			hostname=$(printf '%s' "$board_json" | jsonfilter -e '@.hostname' 2>/dev/null)
			model=$(printf '%s' "$board_json" | jsonfilter -e '@.model' 2>/dev/null)
			build=$(printf '%s' "$board_json" | jsonfilter -e '@.release.description' 2>/dev/null)
			kernel=$(printf '%s' "$board_json" | jsonfilter -e '@.kernel' 2>/dev/null)
		fi
		if [ -z "$hostname" ] || [ -z "$model" ] || [ -z "$build" ] || [ -z "$kernel" ]; then
			parsed_board=$(printf '%s' "$board_json" | awk '
				function get_val(str, key) {
					regex = "\"" key "\"[ \t]*:[ \t]*\"[^\"]+\"";
					if (match(str, regex)) {
						m = substr(str, RSTART, RLENGTH);
						sub(/^"[^"]+"[ \t]*:[ \t]*"/, "", m);
						sub(/"$/, "", m);
						return m;
					}
					return "";
				}
				{ str = str $0 }
				END {
					printf "%s\t%s\t%s\t%s\n", get_val(str, "hostname"), get_val(str, "model"), get_val(str, "description"), get_val(str, "kernel");
				}
			')
			tab="$(printf '\t')"
			old_ifs="$IFS"
			IFS="$tab"
			read -r b_host b_model b_build b_kernel <<EOF
$parsed_board
EOF
			IFS="$old_ifs"
			[ -z "$hostname" ] && hostname="$b_host"
			[ -z "$model" ] && model="$b_model"
			[ -z "$build" ] && build="$b_build"
			[ -z "$kernel" ] && kernel="$b_kernel"
		fi
	fi

	# Fallbacks for system identifiers
	if [ -z "$hostname" ]; then
		if [ -f "$PROC_DIR/sys/kernel/hostname" ]; then
			read -r hostname < "$PROC_DIR/sys/kernel/hostname"
		else
			hostname=$(uname -n 2>/dev/null || echo "OpenWrt")
		fi
	fi
	[ -z "$model" ] && model="OpenWrt Device"
	[ -z "$build" ] && build="OpenWrt"
	[ -z "$kernel" ] && kernel=$(uname -r 2>/dev/null || echo "unknown")

	# Uptime
	uptime_val=0
	if [ -f "$PROC_DIR/uptime" ]; then
		read -r uptime_raw _ < "$PROC_DIR/uptime"
		uptime_val="${uptime_raw%.*}"
		[ -z "$uptime_val" ] && uptime_val=0
	fi

	# CPU percent
	cpu_pct=$(awk -v u1="$c_u1" -v n1="$c_n1" -v s1="$c_s1" -v i1="$c_i1" -v w1="$c_w1" -v ir1="$c_ir1" -v so1="$c_so1" -v st1="$c_st1" \
	              -v u2="$c_u2" -v n2="$c_n2" -v s2="$c_s2" -v i2="$c_i2" -v w2="$c_w2" -v ir2="$c_ir2" -v so2="$c_so2" -v st2="$c_st2" '
		BEGIN {
			tot1 = u1 + n1 + s1 + i1 + w1 + ir1 + so1 + st1;
			act1 = u1 + n1 + s1 + ir1 + so1 + st1;
			tot2 = u2 + n2 + s2 + i2 + w2 + ir2 + so2 + st2;
			act2 = u2 + n2 + s2 + ir2 + so2 + st2;
			dtot = tot2 - tot1;
			dact = act2 - act1;
			if (dtot > 0) {
				pct = (dact * 100.0) / dtot;
				if (pct < 0.0) pct = 0.0;
				if (pct > 100.0) pct = 100.0;
				printf "%.1f", pct;
			} else {
				printf "0.0";
			}
		}')

	# CPU loadavg
	l1="0.00" l2="0.00" l3="0.00"
	if [ -f "$PROC_DIR/loadavg" ]; then
		read -r l1 l2 l3 _ < "$PROC_DIR/loadavg"
	fi

	# CPU cores
	cpu_cores=1
	if [ -f "$PROC_DIR/cpuinfo" ]; then
		cpu_cores=$(grep -c '^processor' "$PROC_DIR/cpuinfo" 2>/dev/null)
		[ -z "$cpu_cores" ] || [ "$cpu_cores" -le 0 ] && cpu_cores=1
	fi

	# Memory info
	mem_total_kb=0
	mem_used_kb=0
	mem_pct="0.0"
	if [ -f "$PROC_DIR/meminfo" ]; then
		mem_eval=$(awk '
			/^MemTotal:/ { tot = $2 }
			/^MemAvailable:/ { avail = $2 }
			/^MemFree:/ { free = $2 }
			/^Buffers:/ { buf = $2 }
			/^Cached:/ { cache = $2 }
			END {
				if (!avail) avail = free + buf + cache;
				used = tot - avail;
				if (used < 0) used = 0;
				pct = (tot > 0) ? (used * 100.0) / tot : 0.0;
				printf "%d %d %.1f", tot, used, pct;
			}
		' "$PROC_DIR/meminfo")
		read -r mem_total_kb mem_used_kb mem_pct <<EOF
$mem_eval
EOF
	fi

	# Disk info: df /overlay fallback df /
	disk_eval=""
	if command -v df >/dev/null 2>&1; then
		disk_eval=$(df -k /overlay 2>/dev/null | awk 'NR>1 {tot=$2; used=$3; pct=(tot>0)?(used*100.0)/tot:0.0; printf "%d %d %.1f", tot, used, pct; exit}')
		if [ -z "$disk_eval" ]; then
			disk_eval=$(df -k / 2>/dev/null | awk 'NR>1 {tot=$2; used=$3; pct=(tot>0)?(used*100.0)/tot:0.0; printf "%d %d %.1f", tot, used, pct; exit}')
		fi
	fi
	[ -z "$disk_eval" ] && disk_eval="0 0 0.0"
	read -r disk_total_kb disk_used_kb disk_pct <<EOF
$disk_eval
EOF

	# Temperature: probe /sys/class/thermal/thermal_zone*/temp
	temp_celsius="null"
	temp_available="false"
	for z in "$SYS_DIR"/class/thermal/thermal_zone*/temp; do
		if [ -f "$z" ]; then
			raw_t=$(cat "$z" 2>/dev/null)
			case "$raw_t" in
				''|*[!0-9]*) ;;
				*)
					if [ "$raw_t" -gt 0 ]; then
						temp_celsius=$(awk -v t="$raw_t" 'BEGIN { printf "%.1f", (t > 1000 ? t / 1000.0 : t * 1.0) }')
						temp_available="true"
						break
					fi
					;;
			esac
		fi
	done

	# Write /tmp/dashboard/system.json
	cat <<EOF | atomic_write "$CACHE_DIR/system.json"
{
  "hostname": "$hostname",
  "model": "$model",
  "build": "$build",
  "kernel": "$kernel",
  "uptime": $uptime_val,
  "cpu": {
    "percent": $cpu_pct,
    "load": [$l1, $l2, $l3],
    "cores": $cpu_cores
  },
  "memory": {
    "total_kb": $mem_total_kb,
    "used_kb": $mem_used_kb,
    "percent": $mem_pct
  },
  "disk": {
    "total_kb": $disk_total_kb,
    "used_kb": $disk_used_kb,
    "percent": $disk_pct
  },
  "temp": {
    "celsius": $temp_celsius,
    "available": $temp_available
  }
}
EOF
}

# Collect traffic
collect_traffic() {
	now=$(date +%s)
	wan_if=$(resolve_wan_if)

	rx_bytes=0
	tx_bytes=0
	if [ -n "$wan_if" ] && [ -f "$SYS_DIR/class/net/$wan_if/statistics/rx_bytes" ]; then
		rx_bytes=$(cat "$SYS_DIR/class/net/$wan_if/statistics/rx_bytes" 2>/dev/null || echo 0)
		tx_bytes=$(cat "$SYS_DIR/class/net/$wan_if/statistics/tx_bytes" 2>/dev/null || echo 0)
	fi

	rx_bps=0
	tx_bps=0
	state_file="$STATE_DIR/traffic_state"
	history_file="$STATE_DIR/traffic_history"

	if [ -f "$state_file" ]; then
		read -r prev_t prev_rx prev_tx < "$state_file"
		dt=$((now - prev_t))
		if [ "$dt" -gt 0 ]; then
			if [ "$rx_bytes" -ge "$prev_rx" ]; then
				rx_bps=$(( (rx_bytes - prev_rx) * 8 / dt ))
			fi
			if [ "$tx_bytes" -ge "$prev_tx" ]; then
				tx_bps=$(( (tx_bytes - prev_tx) * 8 / dt ))
			fi
		fi
	fi
	echo "$now $rx_bytes $tx_bytes" > "$state_file"

	# Append history and cap at 60 entries (5 minutes at 5s intervals)
	echo "{\"t\": $now, \"rx_bps\": $rx_bps, \"tx_bps\": $tx_bps}" >> "$history_file"
	tail -n 60 "$history_file" > "${history_file}.tmp" && mv "${history_file}.tmp" "$history_file"

	history_json=$(awk 'BEGIN{first=1} {if(!first) printf ", "; printf "%s", $0; first=0}' "$history_file")

	cat <<EOF | atomic_write "$CACHE_DIR/traffic.json"
{
  "rx_bps": $rx_bps,
  "tx_bps": $tx_bps,
  "rx_total_bytes": $rx_bytes,
  "tx_total_bytes": $tx_bytes,
  "history": [ $history_json ]
}
EOF
}

# Collect processes
collect_processes() {
	total_jiffies="$1"
	proc_prev="$STATE_DIR/proc_prev"
	proc_next="$STATE_DIR/proc_prev.tmp"

	# Stream all /proc/[0-9]*/stat via cat to prevent BusyBox awk from crashing
	# if any process exits during scanning.
	cat "$PROC_DIR"/[0-9]*/stat 2>/dev/null | awk -v curr_total="$total_jiffies" \
	                                             -v prev_file="$proc_prev" \
	                                             -v next_file="$proc_next" '
		BEGIN {
			prev_total = 0;
			if (prev_file != "") {
				while ((getline line < prev_file) > 0) {
					n = split(line, f, " ");
					if (f[1] == "TOTAL") {
						prev_total = f[2];
					} else if (n >= 2) {
						prev_ticks[f[1]] = f[2];
					}
				}
				close(prev_file);
			}
			pid_count = 0;
		}

		{
			# Field 1: PID, Field 2: (comm) which can contain spaces
			idx1 = index($0, "(");
			idx2 = 0;
			for (i = length($0); i > idx1; i--) {
				if (substr($0, i, 1) == ")") {
					idx2 = i;
					break;
				}
			}
			if (idx1 > 0 && idx2 > idx1) {
				pid = substr($0, 1, idx1 - 1) + 0;
				if (pid <= 0) next;

				comm = substr($0, idx1 + 1, idx2 - idx1 - 1);
				gsub(/\\/, "\\\\", comm);
				gsub(/"/, "\\\"", comm);

				rest = substr($0, idx2 + 2);
				split(rest, fields, " ");
				utime = fields[12] + 0;
				stime = fields[13] + 0;
				vsize = fields[21] + 0;
				rss_pages = fields[22] + 0;

				# Convert RSS pages to KB (page size = 4KB standard on Linux)
				mem_kb = (rss_pages > 0) ? (rss_pages * 4) : int(vsize / 1024);

				tot = utime + stime;
				curr_ticks[pid] = tot;
				proc_name[pid] = comm;
				proc_mem[pid] = mem_kb;

				tot_delta = curr_total - prev_total;
				if (prev_total > 0 && tot_delta > 0 && (pid in prev_ticks)) {
					dt = tot - prev_ticks[pid];
					if (dt < 0) dt = 0;
					pct = (dt * 100.0) / tot_delta;
					if (pct > 100.0) pct = 100.0;
					proc_cpu[pid] = pct;
				} else {
					proc_cpu[pid] = 0.0;
				}

				pids[pid_count++] = pid;
			}
		}

		END {
			# Save current ticks for next run
			print "TOTAL " curr_total > next_file;
			for (i = 0; i < pid_count; i++) {
				p = pids[i];
				if (p in curr_ticks) {
					print p " " curr_ticks[p] > next_file;
				}
			}
			close(next_file);

			# Sort processes by mem_kb descending
			for (i = 0; i < pid_count; i++) {
				p = pids[i];
				sorted_pids[i] = p;
				sorted_mem[i] = (p in proc_mem) ? proc_mem[p] : 0;
			}
			for (i = 1; i < pid_count; i++) {
				key_p = sorted_pids[i];
				key_m = sorted_mem[i];
				j = i - 1;
				while (j >= 0 && sorted_mem[j] < key_m) {
					sorted_pids[j + 1] = sorted_pids[j];
					sorted_mem[j + 1] = sorted_mem[j];
					j--;
				}
				sorted_pids[j + 1] = key_p;
				sorted_mem[j + 1] = key_m;
			}

			# Emit JSON (top 50 processes)
			limit = (pid_count < 50) ? pid_count : 50;
			printf "{\n  \"processes\": [\n";
			first = 1;
			for (i = 0; i < limit; i++) {
				p = sorted_pids[i];
				name = (p in proc_name) ? proc_name[p] : "unknown";
				cpu = (p in proc_cpu) ? proc_cpu[p] : 0.0;
				mem = sorted_mem[i];
				if (!first) printf ",\n";
				first = 0;
				printf "    { \"pid\": %d, \"name\": \"%s\", \"cpu_percent\": %.1f, \"mem_kb\": %d, \"net_bps\": null, \"net_approx\": true }", p, name, cpu, mem;
			}
			printf "\n  ]\n}\n";
		}
	' 2>/dev/null | atomic_write "$CACHE_DIR/processes.json"

	[ -f "$proc_next" ] && mv "$proc_next" "$proc_prev"
}

# Collect clients
collect_clients() {
	leases_file="/tmp/dhcp.leases"
	[ -f "$MOCK_DHCP_LEASES" ] && leases_file="$MOCK_DHCP_LEASES"

	# Optional dependency: nlbwmon.
	# MUST check `ubus list | grep -q nlbwmon` beforehand to avoid failures.
	has_nlbwmon=0
	nlbwmon_state="$STATE_DIR/nlbwmon_dump.tmp.$$"
	rm -f "$nlbwmon_state"

	if command -v ubus >/dev/null 2>&1; then
		if ubus list 2>/dev/null | grep -q 'nlbwmon'; then
			if ubus call nlbwmon dump > "$nlbwmon_state" 2>/dev/null; then
				has_nlbwmon=1
			fi
		fi
	fi

	# Build clients list by merging /tmp/dhcp.leases with ip neigh show
	# Also fallback to /proc/net/arp if ip neigh is not present
	(ip neigh show 2>/dev/null || true) | awk -v leases_file="$leases_file" \
	                                          -v proc_arp="$PROC_DIR/net/arp" \
	                                          -v nlbwmon_file="$nlbwmon_state" \
	                                          -v has_nlbw="$has_nlbwmon" '
		BEGIN {
			# Read DHCP leases: timestamp mac ip hostname client_id
			if (leases_file != "") {
				while ((getline line < leases_file) > 0) {
					n = split(line, f, " ");
					if (n >= 4) {
						mac = toupper(f[2]);
						ip = f[3];
						hname = f[4];
						if (hname == "*") hname = "unknown";
						lease_host[mac] = hname;
						lease_ip[mac] = ip;
						all_macs[mac] = 1;
					}
				}
				close(leases_file);
			}

			# Parse nlbwmon data if available
			if (has_nlbw == 1 && nlbwmon_file != "") {
				while ((getline line < nlbwmon_file) > 0) {
					# Match ["mac", "ip", rx_bytes, tx_bytes, ...]
					if (match(line, /"[0-9a-fA-F:]{17}"/)) {
						m = toupper(substr(line, RSTART + 1, 17));
						# Extract numbers after mac
						tail = substr(line, RSTART + 19);
						gsub(/[^0-9, ]/, "", tail);
						split(tail, nums, ",");
						rx_b = nums[1] + 0;
						tx_b = nums[2] + 0;
						client_total_b[m] = rx_b + tx_b;
						all_macs[m] = 1;
					}
				}
				close(nlbwmon_file);
			}
		}

		# Parse ip neigh show from STDIN
		{
			# format: IP dev DEV lladdr MAC STATE...
			ip = $1;
			for (i = 2; i <= NF; i++) {
				if ($i == "lladdr" && (i + 1) <= NF) {
					mac = toupper($(i + 1));
					state = $(NF);
					# Exclude failed / incomplete entries
					if (state ~ /REACHABLE|STALE|DELAY|PROBE/) {
						active_ip[mac] = ip;
						all_macs[mac] = 1;
					}
					break;
				}
			}
		}

		END {
			# If active_ip was empty, try /proc/net/arp
			if (length(active_ip) == 0 && proc_arp != "") {
				while ((getline line < proc_arp) > 0) {
					n = split(line, f, " ");
					# IP HW_type Flags HW_address Mask Device
					if (n >= 6 && f[1] != "IP") {
						mac = toupper(f[4]);
						flags = f[3];
						if (mac != "00:00:00:00:00:00" && flags != "0x0") {
							active_ip[mac] = f[1];
							all_macs[mac] = 1;
						}
					}
				}
				close(proc_arp);
			}

			printf "{\n  \"clients\": [\n";
			first = 1;
			for (mac in all_macs) {
				ip = (mac in active_ip) ? active_ip[mac] : lease_ip[mac];
				if (ip == "") continue;
				hname = (mac in lease_host) ? lease_host[mac] : "unknown";
				gsub(/\\/, "\\\\", hname);
				gsub(/"/, "\\\"", hname);

				tot_b = (mac in client_total_b) ? client_total_b[mac] : 0;

				if (!first) printf ",\n";
				first = 0;
				printf "    { \"mac\": \"%s\", \"ip\": \"%s\", \"hostname\": \"%s\", \"rx_bps\": 0, \"tx_bps\": 0, \"total_bytes\": %d }", mac, ip, hname, tot_b;
			}
			printf "\n  ]\n}\n";
		}
	' 2>/dev/null | atomic_write "$CACHE_DIR/clients.json"

	rm -f "$nlbwmon_state"
}

# Collect ports
collect_ports() {
	now=$(date +%s)
	ports_state="$STATE_DIR/ports_prev"
	ports_next="$STATE_DIR/ports_prev.tmp"
	rm -f "$ports_next"

	ports_json=""
	first=1

	for if_dir in "$SYS_DIR"/class/net/*; do
		[ -d "$if_dir" ] || continue
		if_name="${if_dir##*/}"

		# Filter out lo, bridges, vlans, virtual interfaces
		case "$if_name" in
			lo|br-*|br_*|br0|*.*|sit*|gre*|tun*|tap*|wg*|dummy*|teql*) continue ;;
		esac

		# Label in uppercase
		label=$(printf '%s' "$if_name" | tr 'a-z' 'A-Z')

		# Status from ethtool or sysfs fallback
		link="false"
		speed=0
		duplex="unknown"

		if command -v ethtool >/dev/null 2>&1; then
			eth_out=$(ethtool "$if_name" 2>/dev/null)
			if [ -n "$eth_out" ]; then
				case "$eth_out" in
					*"Link detected: yes"*) link="true" ;;
					*"Link detected: no"*) link="false" ;;
				esac

				spd_raw=$(printf '%s' "$eth_out" | awk -F': ' '/Speed:/ {print $2}')
				case "$spd_raw" in
					*Mb/s*) speed="${spd_raw%%Mb/s*}" ;;
					*Gb/s*) speed=$(( ${spd_raw%%Gb/s*} * 1000 )) ;;
				esac
				case "$speed" in
					''|*[!0-9]*) speed=0 ;;
				esac

				dpx_raw=$(printf '%s' "$eth_out" | awk -F': ' '/Duplex:/ {print $2}')
				case "$dpx_raw" in
					Full*) duplex="full" ;;
					Half*) duplex="half" ;;
				esac
			fi
		fi

		# Fallback to sysfs if ethtool failed or was missing
		if [ "$duplex" = "unknown" ] && [ "$speed" -eq 0 ]; then
			if [ -f "$if_dir/carrier" ]; then
				c_val=$(cat "$if_dir/carrier" 2>/dev/null)
				[ "$c_val" = "1" ] && link="true"
			fi
			if [ -f "$if_dir/speed" ]; then
				s_val=$(cat "$if_dir/speed" 2>/dev/null)
				case "$s_val" in
					''|*[!0-9]*) ;;
					*) speed="$s_val" ;;
				esac
			fi
			if [ -f "$if_dir/duplex" ]; then
				d_val=$(cat "$if_dir/duplex" 2>/dev/null)
				case "$d_val" in
					full|half) duplex="$d_val" ;;
				esac
			fi
		fi

		# Bytes counters
		rx_bytes=0
		tx_bytes=0
		[ -f "$if_dir/statistics/rx_bytes" ] && rx_bytes=$(cat "$if_dir/statistics/rx_bytes" 2>/dev/null || echo 0)
		[ -f "$if_dir/statistics/tx_bytes" ] && tx_bytes=$(cat "$if_dir/statistics/tx_bytes" 2>/dev/null || echo 0)

		# Delta bps
		rx_bps=0
		tx_bps=0
		if [ -f "$ports_state" ]; then
			prev_line=$(grep "^${if_name} " "$ports_state" 2>/dev/null)
			if [ -n "$prev_line" ]; then
				read -r _ p_t p_rx p_tx <<EOF
$prev_line
EOF
				dt=$((now - p_t))
				if [ "$dt" -gt 0 ]; then
					if [ "$rx_bytes" -ge "$p_rx" ]; then
						rx_bps=$(( (rx_bytes - p_rx) * 8 / dt ))
					fi
					if [ "$tx_bytes" -ge "$p_tx" ]; then
						tx_bps=$(( (tx_bytes - p_tx) * 8 / dt ))
					fi
				fi
			fi
		fi
		echo "$if_name $now $rx_bytes $tx_bytes" >> "$ports_next"

		port_entry="    { \"name\": \"$if_name\", \"label\": \"$label\", \"link\": $link, \"speed_mbps\": $speed, \"duplex\": \"$duplex\", \"rx_bps\": $rx_bps, \"tx_bps\": $tx_bps, \"rx_total_bytes\": $rx_bytes, \"tx_total_bytes\": $tx_bytes }"
		if [ "$first" -eq 1 ]; then
			first=0
			ports_json="$port_entry"
		else
			ports_json="${ports_json},
${port_entry}"
		fi
	done

	cat <<EOF | atomic_write "$CACHE_DIR/ports.json"
{
  "ports": [
${ports_json}
  ]
}
EOF

	[ -f "$ports_next" ] && mv "$ports_next" "$ports_state"
}

# Main collector loop
main_loop() {
	while true; do
		loop_start=$(date +%s)

		# Read initial /proc/stat sample
		u1=0 n1=0 s1=0 i1=0 w1=0 ir1=0 so1=0 st1=0
		if [ -f "$PROC_DIR/stat" ]; then
			read -r _ u1 n1 s1 i1 w1 ir1 so1 st1 _ < "$PROC_DIR/stat"
		fi

		# Sleep ~1s between CPU readings
		sleep 1

		# Read second /proc/stat sample
		u2=0 n2=0 s2=0 i2=0 w2=0 ir2=0 so2=0 st2=0
		if [ -f "$PROC_DIR/stat" ]; then
			read -r _ u2 n2 s2 i2 w2 ir2 so2 st2 _ < "$PROC_DIR/stat"
		fi

		tot_jiffies=$((u2 + n2 + s2 + i2 + w2 + ir2 + so2 + st2))

		# Collect all components
		collect_system "$u1" "$n1" "$s1" "$i1" "$w1" "$ir1" "$so1" "$st1" \
		               "$u2" "$n2" "$s2" "$i2" "$w2" "$ir2" "$so2" "$st2"
		collect_traffic
		collect_processes "$tot_jiffies"
		collect_clients
		collect_ports

		[ "$RUN_ONCE" -eq 1 ] && break

		# Maintain ~5 second interval
		loop_end=$(date +%s)
		elapsed=$((loop_end - loop_start))
		sleep_rem=$((5 - elapsed))
		[ "$sleep_rem" -le 0 ] && sleep_rem=1
		sleep "$sleep_rem"
	done
}

main_loop
