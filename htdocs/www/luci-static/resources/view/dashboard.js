'use strict';
'require view';
'require poll';
'require ui';
'require rpc';

// RPC definitions for luci.dashboard ubus object
var callSystem = rpc.declare({
	object: 'luci.dashboard',
	method: 'system_info'
});

var callTraffic = rpc.declare({
	object: 'luci.dashboard',
	method: 'traffic'
});

var callProc = rpc.declare({
	object: 'luci.dashboard',
	method: 'processes',
	params: ['limit', 'sort']
});

var callClients = rpc.declare({
	object: 'luci.dashboard',
	method: 'clients'
});

var callPorts = rpc.declare({
	object: 'luci.dashboard',
	method: 'ports'
});

// i18n helper compatible with LuCI gettext
var _ = (typeof _ === 'function') ? _ : function(s) { return s; };

// SVG Namespace helper for standards-compliant SVG rendering
var SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs, children) {
	var el = document.createElementNS(SVG_NS, tag);
	if (attrs) {
		for (var k in attrs) {
			if (Object.prototype.hasOwnProperty.call(attrs, k)) {
				el.setAttribute(k, attrs[k]);
			}
		}
	}
	if (children) {
		if (!Array.isArray(children)) children = [children];
		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			if (typeof child === 'string') {
				el.appendChild(document.createTextNode(child));
			} else if (child) {
				el.appendChild(child);
			}
		}
	}
	return el;
}

// Formatting utilities
function formatBps(bps) {
	if (bps === null || bps === undefined) return '—';
	bps = Number(bps);
	if (isNaN(bps)) return '—';
	if (bps >= 1e9) return (bps / 1e9).toFixed(2) + ' Gbps';
	if (bps >= 1e6) return (bps / 1e6).toFixed(2) + ' Mbps';
	if (bps >= 1e3) return (bps / 1e3).toFixed(1) + ' Kbps';
	return bps + ' bps';
}

function formatBytes(bytes) {
	if (bytes === null || bytes === undefined) return '—';
	bytes = Number(bytes);
	if (isNaN(bytes)) return '—';
	if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB';
	if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
	if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
	if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
	return bytes + ' B';
}

function formatKb(kb) {
	if (kb === null || kb === undefined) return '—';
	kb = Number(kb);
	if (isNaN(kb)) return '—';
	if (kb >= 1048576) return (kb / 1048576).toFixed(2) + ' GB';
	if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
	return kb + ' KB';
}

function formatUptime(sec) {
	sec = Math.floor(Number(sec) || 0);
	var d = Math.floor(sec / 86400);
	var h = Math.floor((sec % 86400) / 3600);
	var m = Math.floor((sec % 3600) / 60);
	var s = sec % 60;
	var parts = [];
	if (d > 0) parts.push(d + 'd');
	if (h > 0 || d > 0) parts.push(h + 'h');
	if (m > 0 || h > 0 || d > 0) parts.push(m + 'm');
	parts.push(s + 's');
	return parts.join(' ');
}

return view.extend({
	pollRegistered: false,
	currentSort: 'mem',
	currentLimit: 30,
	trafficHistory: [],
	domNodes: {},

	// 1. Initial Load using live ubus RPC with fallback safety
	load: function() {
		var limit = this.currentLimit || 30;
		var sort = this.currentSort || 'mem';

		return Promise.all([
			callSystem().catch(function(err) {
				console.warn('luci.dashboard system_info RPC failed:', err);
				return {};
			}),
			callTraffic().catch(function(err) {
				console.warn('luci.dashboard traffic RPC failed:', err);
				return {};
			}),
			callProc(limit, sort).catch(function(err) {
				console.warn('luci.dashboard processes RPC failed:', err);
				return { processes: [] };
			}),
			callClients().catch(function(err) {
				console.warn('luci.dashboard clients RPC failed:', err);
				return { clients: [] };
			}),
			callPorts().catch(function(err) {
				console.warn('luci.dashboard ports RPC failed:', err);
				return { ports: [] };
			})
		]);
	},

	// 2. Asset injection (CSS stylesheet) once
	injectAssets: function() {
		if (!document.getElementById('luci-dashboard-noc-css')) {
			var link = document.createElement('link');
			link.id = 'luci-dashboard-noc-css';
			link.rel = 'stylesheet';
			link.type = 'text/css';
			link.href = L.resource('dashboard/dashboard.css');
			document.head.appendChild(link);
		}
	},

	// 3. Periodic refresh every 5 seconds (called by poll.add)
	refresh: function() {
		var self = this;
		var limit = this.currentLimit || 30;
		var sort = this.currentSort || 'mem';

		return Promise.all([
			callSystem().catch(function() { return {}; }),
			callTraffic().catch(function() { return {}; }),
			callProc(limit, sort).catch(function() { return { processes: [] }; }),
			callClients().catch(function() { return { clients: [] }; }),
			callPorts().catch(function() { return { ports: [] }; })
		]).then(function(data) {
			self.updateDOM(data);
		});
	},

	// 4. In-place DOM update dispatcher
	updateDOM: function(data) {
		if (!data || !Array.isArray(data)) return;
		var sys = data[0] || {};
		var traf = data[1] || {};
		var proc = data[2] || { processes: [] };
		var cl = data[3] || { clients: [] };
		var ports = data[4] || { ports: [] };

		this.updateHeader(sys);
		this.updateGauges(sys);
		this.updateTraffic(traf);
		this.updateProcessTable(proc);
		this.updateClientTable(cl);
		this.updatePortPanel(ports);
	},

	// Update Header
	updateHeader: function(sys) {
		if (!this.domNodes.header) return;
		this.domNodes.header.hostname.textContent = sys.hostname || 'OpenWrt';
		this.domNodes.header.subtitle.textContent = (sys.model || 'Generic OpenWrt Device') + ' • ' + (sys.build || 'OpenWrt Linux');
		this.domNodes.header.kernel.textContent = sys.kernel || 'Unknown';
		this.domNodes.header.uptime.textContent = formatUptime(sys.uptime);
	},

	// Update Circular Gauges
	updateGauges: function(sys) {
		if (!this.domNodes.gauges) return;
		var cpu = sys.cpu || {};
		var mem = sys.memory || {};
		var disk = sys.disk || {};
		var temp = sys.temp || {};

		// CPU Gauge
		var cpuPct = Math.max(0, Math.min(100, Number(cpu.percent) || 0));
		var cpuColor = (cpuPct > 85) ? 'noc-gauge-val-red' : ((cpuPct > 70) ? 'noc-gauge-val-amber' : 'noc-gauge-val-cyan');
		this.applyGaugeUpdate(
			this.domNodes.gauges.cpu,
			cpuPct,
			cpuPct.toFixed(1) + '%',
			(cpu.cores || 1) + ' ' + _('CORES'),
			_('LOAD:') + ' ' + (cpu.load ? cpu.load.join(', ') : '0.00, 0.00, 0.00'),
			_('ACTIVE'),
			cpuColor
		);

		// RAM Gauge
		var memPct = Math.max(0, Math.min(100, Number(mem.percent) || 0));
		var memColor = (memPct > 85) ? 'noc-gauge-val-red' : ((memPct > 70) ? 'noc-gauge-val-amber' : 'noc-gauge-val-cyan');
		this.applyGaugeUpdate(
			this.domNodes.gauges.mem,
			memPct,
			memPct.toFixed(1) + '%',
			formatKb(mem.used_kb) + ' ' + _('USED'),
			_('FREE:') + ' ' + formatKb((mem.total_kb || 0) - (mem.used_kb || 0)),
			_('TOTAL:') + ' ' + formatKb(mem.total_kb),
			memColor
		);

		// Storage Gauge
		var diskPct = Math.max(0, Math.min(100, Number(disk.percent) || 0));
		var diskColor = (diskPct > 85) ? 'noc-gauge-val-red' : ((diskPct > 70) ? 'noc-gauge-val-amber' : 'noc-gauge-val-cyan');
		this.applyGaugeUpdate(
			this.domNodes.gauges.disk,
			diskPct,
			diskPct.toFixed(1) + '%',
			formatKb(disk.used_kb) + ' ' + _('USED'),
			_('FREE:') + ' ' + formatKb((disk.total_kb || 0) - (disk.used_kb || 0)),
			_('TOTAL:') + ' ' + formatKb(disk.total_kb),
			diskColor
		);

		// SoC Temperature Gauge (handle temp.available === false cleanly)
		if (temp.available && temp.celsius !== null && temp.celsius !== undefined) {
			var tempVal = Number(temp.celsius) || 0;
			var tempPct = Math.min(100, Math.max(0, (tempVal - 30) * 1.6));
			var tempColor = (tempVal > 75) ? 'noc-gauge-val-red' : ((tempVal > 60) ? 'noc-gauge-val-amber' : 'noc-gauge-val-green');
			this.applyGaugeUpdate(
				this.domNodes.gauges.temp,
				tempPct,
				tempVal.toFixed(1) + '°C',
				_('THERMAL ZONE'),
				_('STATUS'),
				(tempVal > 75 ? _('HOT') : _('NORMAL')),
				tempColor
			);
		} else {
			// Sensor unavailable: show —
			this.applyGaugeUpdate(
				this.domNodes.gauges.temp,
				0,
				'—',
				_('NO SENSOR'),
				_('STATUS'),
				_('DISABLED'),
				'noc-gauge-val-cyan'
			);
		}
	},

	applyGaugeUpdate: function(node, pct, numText, unitText, footLeft, footRight, colorClass) {
		if (!node) return;
		var radius = 54;
		var circumference = 2 * Math.PI * radius;
		var offset = circumference - (pct / 100) * circumference;

		node.circle.setAttribute('stroke-dashoffset', offset.toFixed(2));
		node.circle.setAttribute('class', 'noc-gauge-val ' + colorClass);
		node.centerNum.textContent = numText;
		node.centerUnit.textContent = unitText;
		node.footerLeft.textContent = footLeft;
		node.footerRight.textContent = footRight;
	},

	// Update Traffic Panel & Chart
	updateTraffic: function(traf) {
		if (!this.domNodes.traffic) return;

		this.domNodes.traffic.rxRate.textContent = formatBps(traf.rx_bps);
		this.domNodes.traffic.txRate.textContent = formatBps(traf.tx_bps);
		this.domNodes.traffic.rxTotal.textContent = formatBytes(traf.rx_total_bytes);
		this.domNodes.traffic.txTotal.textContent = formatBytes(traf.tx_total_bytes);

		if (traf.history && Array.isArray(traf.history) && traf.history.length > 0) {
			this.trafficHistory = traf.history;
		} else if (traf.rx_bps !== undefined && traf.tx_bps !== undefined) {
			// Append latest sample if history was not directly returned
			var nowT = Math.floor(Date.now() / 1000);
			this.trafficHistory.push({
				t: nowT,
				rx_bps: Number(traf.rx_bps) || 0,
				tx_bps: Number(traf.tx_bps) || 0
			});
		}

		// Cap history at 60 points (5 minutes) to prevent memory leak
		if (this.trafficHistory.length > 60) {
			this.trafficHistory = this.trafficHistory.slice(-60);
		}

		this.drawTrafficChart(this.domNodes.traffic.canvas, this.trafficHistory);
	},

	// Update Processes Table
	updateProcessTable: function(proc) {
		if (!this.domNodes.procTbody) return;
		this.lastProcData = proc;
		var tbody = this.domNodes.procTbody;
		while (tbody.firstChild) {
			tbody.removeChild(tbody.firstChild);
		}

		var procs = (proc && Array.isArray(proc.processes)) ? proc.processes.slice() : [];
		if (procs.length === 0) {
			tbody.appendChild(E('tr', {}, [
				E('td', { 'colspan': '5', 'style': 'text-align: center; color: var(--muted); padding: 20px;' }, _('No process information available'))
			]));
			return;
		}

		// Sort client-side by active tab
		var sortKey = this.currentSort || 'mem';
		procs.sort(function(a, b) {
			if (sortKey === 'cpu') {
				return (Number(b.cpu_percent) || 0) - (Number(a.cpu_percent) || 0);
			} else if (sortKey === 'net') {
				var netA = (a.net_bps !== null && a.net_bps !== undefined) ? Number(a.net_bps) : -1;
				var netB = (b.net_bps !== null && b.net_bps !== undefined) ? Number(b.net_bps) : -1;
				return netB - netA;
			} else {
				return (Number(b.mem_kb) || 0) - (Number(a.mem_kb) || 0);
			}
		});

		for (var p = 0; p < procs.length; p++) {
			var pr = procs[p];
			var cpuPercent = Number(pr.cpu_percent) || 0;

			// net_bps: null -> show "—" instead of "0 KB/s"
			var netDisplay = '—';
			if (pr.net_bps !== null && pr.net_bps !== undefined) {
				netDisplay = formatBps(pr.net_bps);
			}

			// net_approx: true -> prepend "≈"
			var netCellChildren = [netDisplay];
			if (pr.net_approx && pr.net_bps !== null && pr.net_bps !== undefined) {
				netCellChildren.push(E('span', { 'class': 'noc-approx-icon', 'title': _('Estimated bandwidth') }, ' ≈'));
			}

			tbody.appendChild(E('tr', {}, [
				E('td', { 'class': 'noc-mono' }, (pr.pid !== undefined && pr.pid !== null) ? pr.pid.toString() : '—'),
				E('td', { 'class': 'noc-proc-name' }, pr.name || 'unknown'),
				E('td', {}, [
					E('div', { 'class': 'noc-proc-bar-wrap' }, [
						E('div', { 'class': 'noc-proc-bar' }, [
							E('div', { 'class': 'noc-proc-bar-fill', 'style': 'width: ' + Math.min(100, cpuPercent * 2) + '%' })
						]),
						E('span', { 'class': 'noc-mono' }, cpuPercent.toFixed(1) + '%')
					])
				]),
				E('td', { 'class': 'noc-mono' }, formatKb(pr.mem_kb)),
				E('td', { 'class': 'noc-mono' }, netCellChildren)
			]));
		}
	},

	// Update Connected Clients Table
	updateClientTable: function(cl) {
		if (!this.domNodes.clientTbody) return;
		var tbody = this.domNodes.clientTbody;
		while (tbody.firstChild) {
			tbody.removeChild(tbody.firstChild);
		}

		var clientList = (cl && cl.clients) ? cl.clients : [];
		if (this.domNodes.clientBadge) {
			this.domNodes.clientBadge.textContent = clientList.length + ' ' + _('ACTIVE');
		}

		if (clientList.length === 0) {
			tbody.appendChild(E('tr', {}, [
				E('td', { 'colspan': '5', 'style': 'text-align: center; color: var(--muted); padding: 20px;' }, _('No active clients detected'))
			]));
			return;
		}

		for (var c = 0; c < clientList.length; c++) {
			var cli = clientList[c];
			tbody.appendChild(E('tr', {}, [
				E('td', { 'class': 'noc-proc-name' }, [
					E('span', { 'class': 'noc-pulse-dot', 'style': 'display:inline-block; margin-right:4px;' }),
					cli.hostname || 'Unknown Device'
				]),
				E('td', { 'class': 'noc-mono' }, cli.ip || '—'),
				E('td', { 'class': 'noc-mono', 'style': 'color: var(--muted); font-size: 11px;' }, cli.mac || '—'),
				E('td', { 'class': 'noc-mono' }, [
					E('span', { 'style': 'color: var(--cyan);' }, '↓ ' + formatBps(cli.rx_bps)),
					' ',
					E('span', { 'style': 'color: var(--amber);' }, '↑ ' + formatBps(cli.tx_bps))
				]),
				E('td', { 'class': 'noc-mono' }, formatBytes(cli.total_bytes))
			]));
		}
	},

	// Update Physical Ports Panel
	updatePortPanel: function(ports) {
		if (!this.domNodes.portMatrix || !this.domNodes.portTbody) return;
		var matrix = this.domNodes.portMatrix;
		var tbody = this.domNodes.portTbody;

		while (matrix.firstChild) matrix.removeChild(matrix.firstChild);
		while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

		var portList = (ports && ports.ports) ? ports.ports : [];
		if (portList.length === 0) {
			tbody.appendChild(E('tr', {}, [
				E('td', { 'colspan': '7', 'style': 'text-align: center; color: var(--muted); padding: 20px;' }, _('No physical network ports found'))
			]));
			return;
		}

		for (var pt = 0; pt < portList.length; pt++) {
			var port = portList[pt];
			var isLinked = Boolean(port.link);
			var speedStr = isLinked ? (port.speed_mbps ? port.speed_mbps + 'M ' + (port.duplex || 'full') : _('CONNECTED')) : _('No Link');

			// Jack visual
			matrix.appendChild(E('div', { 'class': 'noc-port-jack' + (isLinked ? ' is-linked' : '') }, [
				E('div', { 'class': 'noc-port-leds' }, [
					E('div', { 'class': 'noc-led noc-led-link' + (isLinked ? ' on' : ''), 'title': _('Link Status') }),
					E('div', { 'class': 'noc-led noc-led-act' + (isLinked && (port.rx_bps > 0 || port.tx_bps > 0) ? ' on' : ''), 'title': _('Activity') })
				]),
				E('div', { 'class': 'noc-port-label' }, port.label || port.name),
				E('div', { 'class': 'noc-port-speed' + (isLinked ? ' active' : '') }, speedStr),
				E('div', { 'class': 'noc-port-status-badge ' + (isLinked ? 'up' : 'down') }, isLinked ? _('CONNECTED') : _('DOWN'))
			]));

			// Table Row
			tbody.appendChild(E('tr', {}, [
				E('td', { 'class': 'noc-proc-name' }, port.label || port.name),
				E('td', {}, E('span', { 'class': 'noc-port-status-badge ' + (isLinked ? 'up' : 'down') }, isLinked ? _('UP') : _('DOWN'))),
				E('td', { 'class': 'noc-mono' }, speedStr),
				E('td', { 'class': 'noc-mono' }, formatBps(port.rx_bps)),
				E('td', { 'class': 'noc-mono' }, formatBps(port.tx_bps)),
				E('td', { 'class': 'noc-mono' }, formatBytes(port.rx_total_bytes)),
				E('td', { 'class': 'noc-mono' }, formatBytes(port.tx_total_bytes))
			]));
		}
	},

	// Helper to instantiate circular gauge card and capture node references
	createGaugeCardRef: function(title) {
		var radius = 54;
		var circumference = 2 * Math.PI * radius;

		var trackCircle = createSvgElement('circle', {
			'class': 'noc-gauge-track',
			'cx': '70',
			'cy': '70',
			'r': radius.toString()
		});

		var valCircle = createSvgElement('circle', {
			'class': 'noc-gauge-val noc-gauge-val-cyan',
			'cx': '70',
			'cy': '70',
			'r': radius.toString(),
			'stroke-dasharray': circumference.toFixed(2),
			'stroke-dashoffset': circumference.toFixed(2)
		});

		var svg = createSvgElement('svg', { 'class': 'noc-gauge-svg', 'viewBox': '0 0 140 140' }, [
			trackCircle,
			valCircle
		]);

		var centerNum = E('div', { 'class': 'noc-gauge-center-num' }, '0.0%');
		var centerUnit = E('div', { 'class': 'noc-gauge-center-unit' }, '');
		var footerLeft = E('span', {}, '');
		var footerRight = E('span', { 'class': 'noc-gauge-footer-highlight' }, '');

		var card = E('div', { 'class': 'noc-card' }, [
			E('div', { 'class': 'noc-card-header' }, [
				E('div', { 'class': 'noc-card-title' }, title)
			]),
			E('div', { 'class': 'noc-gauge-body' }, [
				E('div', { 'class': 'noc-gauge-svg-wrap' }, [
					svg,
					E('div', { 'class': 'noc-gauge-center' }, [
						centerNum,
						centerUnit
					])
				])
			]),
			E('div', { 'class': 'noc-gauge-footer' }, [
				footerLeft,
				footerRight
			])
		]);

		return {
			card: card,
			circle: valCircle,
			centerNum: centerNum,
			centerUnit: centerUnit,
			footerLeft: footerLeft,
			footerRight: footerRight
		};
	},

	// High-performance canvas waveform renderer
	drawTrafficChart: function(canvas, history) {
		if (!canvas) return;
		var ctx = canvas.getContext('2d');
		if (!ctx) return;

		var width = canvas.clientWidth || 800;
		var height = canvas.clientHeight || 220;

		var dpr = window.devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.scale(dpr, dpr);

		ctx.clearRect(0, 0, width, height);

		var padding = { top: 20, right: 15, bottom: 25, left: 55 };
		var graphWidth = width - padding.left - padding.right;
		var graphHeight = height - padding.top - padding.bottom;

		var maxRate = 1000000; // minimum 1 Mbps scale
		if (history && history.length > 0) {
			for (var i = 0; i < history.length; i++) {
				if (history[i].rx_bps > maxRate) maxRate = history[i].rx_bps;
				if (history[i].tx_bps > maxRate) maxRate = history[i].tx_bps;
			}
		}
		maxRate = maxRate * 1.15; // 15% headroom

		// Grid lines
		var gridLines = 4;
		ctx.lineWidth = 1;
		ctx.strokeStyle = '#1E2A42';
		ctx.fillStyle = '#7C8BA3';
		ctx.font = '10px ui-monospace, "SF Mono", monospace';
		ctx.textAlign = 'right';

		for (var g = 0; g <= gridLines; g++) {
			var y = padding.top + (graphHeight / gridLines) * g;
			var val = maxRate * (1 - g / gridLines);

			ctx.beginPath();
			ctx.moveTo(padding.left, y);
			ctx.lineTo(padding.left + graphWidth, y);
			ctx.stroke();

			ctx.fillText(formatBps(val), padding.left - 8, y + 3);
		}

		var renderHistory = (history && Array.isArray(history)) ? history.slice() : [];
		if (renderHistory.length === 1) {
			renderHistory.unshift({
				t: renderHistory[0].t - 5,
				rx_bps: 0,
				tx_bps: 0
			});
		}

		if (renderHistory.length < 2) {
			ctx.fillStyle = '#7C8BA3';
			ctx.textAlign = 'center';
			ctx.font = '13px system-ui, sans-serif';
			ctx.fillText(_('Collecting traffic data...'), width / 2, height / 2);
			return;
		}

		var count = renderHistory.length;
		var stepX = graphWidth / (count - 1);

		function drawSeries(key, strokeColor, fillColor, glowColor) {
			var points = [];
			for (var k = 0; k < count; k++) {
				var px = padding.left + k * stepX;
				var valRate = Number(renderHistory[k][key]) || 0;
				var py = padding.top + graphHeight - (valRate / maxRate) * graphHeight;
				points.push({ x: px, y: py });
			}

			// Translucent gradient area fill
			var grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + graphHeight);
			grad.addColorStop(0, fillColor);
			grad.addColorStop(1, 'rgba(11, 18, 32, 0)');

			ctx.beginPath();
			ctx.moveTo(points[0].x, padding.top + graphHeight);
			for (var j = 0; j < points.length; j++) {
				ctx.lineTo(points[j].x, points[j].y);
			}
			ctx.lineTo(points[points.length - 1].x, padding.top + graphHeight);
			ctx.closePath();
			ctx.fillStyle = grad;
			ctx.fill();

			// Glowing stroke line
			ctx.save();
			ctx.beginPath();
			ctx.moveTo(points[0].x, points[0].y);
			for (var p = 1; p < points.length; p++) {
				ctx.lineTo(points[p].x, points[p].y);
			}
			ctx.strokeStyle = strokeColor;
			ctx.lineWidth = 2;
			ctx.shadowColor = glowColor;
			ctx.shadowBlur = 8;
			ctx.stroke();
			ctx.restore();

			// Terminal marker dot
			var lastP = points[points.length - 1];
			ctx.beginPath();
			ctx.arc(lastP.x, lastP.y, 4, 0, Math.PI * 2);
			ctx.fillStyle = strokeColor;
			ctx.fill();
		}

		// Draw Download (RX) Series
		drawSeries('rx_bps', '#22D3EE', 'rgba(34, 211, 238, 0.25)', 'rgba(34, 211, 238, 0.6)');

		// Draw Upload (TX) Series
		drawSeries('tx_bps', '#F5A524', 'rgba(245, 165, 36, 0.22)', 'rgba(245, 165, 36, 0.6)');
	},

	// 5. Initial Layout Construction
	render: function(data) {
		this.injectAssets();
		var self = this;

		// Build Header Nodes
		var hostText = E('h1', { 'class': 'noc-title' }, [
			'OpenWrt',
			E('span', { 'class': 'noc-live-badge' }, [
				E('span', { 'class': 'noc-pulse-dot' }),
				_('NOC WALL LIVE')
			])
		]);
		var subtitleText = E('div', { 'class': 'noc-subtitle' }, 'Connecting to host...');
		var kernelVal = E('span', { 'class': 'noc-badge-value' }, '—');
		var uptimeVal = E('span', { 'class': 'noc-badge-value' }, '—');

		var header = E('div', { 'class': 'noc-header' }, [
			E('div', { 'class': 'noc-header-left' }, [
				E('div', { 'class': 'noc-title-group' }, [
					hostText,
					subtitleText
				])
			]),
			E('div', { 'class': 'noc-header-badges' }, [
				E('div', { 'class': 'noc-badge' }, [
					E('span', { 'class': 'noc-badge-label' }, _('KERNEL')),
					kernelVal
				]),
				E('div', { 'class': 'noc-badge' }, [
					E('span', { 'class': 'noc-badge-label' }, _('UPTIME')),
					uptimeVal
				])
			])
		]);

		this.domNodes.header = {
			hostname: hostText.firstChild, // text node of hostname
			subtitle: subtitleText,
			kernel: kernelVal,
			uptime: uptimeVal
		};

		// Build Gauge Nodes
		var cpuGauge = this.createGaugeCardRef(_('CPU UTILIZATION'));
		var memGauge = this.createGaugeCardRef(_('MEMORY (RAM)'));
		var diskGauge = this.createGaugeCardRef(_('STORAGE (/OVERLAY)'));
		var tempGauge = this.createGaugeCardRef(_('SOC TEMPERATURE'));

		this.domNodes.gauges = {
			cpu: cpuGauge,
			mem: memGauge,
			disk: diskGauge,
			temp: tempGauge
		};

		var gaugeRow = E('div', { 'class': 'noc-gauge-grid' }, [
			cpuGauge.card,
			memGauge.card,
			diskGauge.card,
			tempGauge.card
		]);

		// Build Traffic Nodes
		var rxRate = E('div', { 'class': 'noc-traffic-stat-rate rate-rx' }, '—');
		var txRate = E('div', { 'class': 'noc-traffic-stat-rate rate-tx' }, '—');
		var rxTotal = E('div', { 'class': 'noc-traffic-stat-total-num' }, '—');
		var txTotal = E('div', { 'class': 'noc-traffic-stat-total-num' }, '—');
		var trafficCanvas = E('canvas', { 'class': 'noc-chart-canvas' });

		this.domNodes.traffic = {
			rxRate: rxRate,
			txRate: txRate,
			rxTotal: rxTotal,
			txTotal: txTotal,
			canvas: trafficCanvas
		};

		var trafficPanel = E('div', { 'class': 'noc-card noc-traffic-panel' }, [
			E('div', { 'class': 'noc-card-header' }, [
				E('div', { 'class': 'noc-card-title' }, _('WAN REAL-TIME TRAFFIC WAVEFORM')),
				E('div', { 'class': 'noc-chart-legend' }, [
					E('div', { 'class': 'noc-legend-item' }, [
						E('div', { 'class': 'noc-legend-dot noc-legend-dot-rx' }),
						_('DOWNLOAD (RX)')
					]),
					E('div', { 'class': 'noc-legend-item' }, [
						E('div', { 'class': 'noc-legend-dot noc-legend-dot-tx' }),
						_('UPLOAD (TX)')
					])
				])
			]),
			E('div', { 'class': 'noc-traffic-top' }, [
				E('div', { 'class': 'noc-traffic-stat-box box-rx' }, [
					E('div', {}, [
						E('div', { 'class': 'noc-traffic-stat-dir' }, _('CURRENT DOWNLOAD')),
						rxRate
					]),
					E('div', { 'class': 'noc-traffic-stat-total' }, [
						E('div', {}, _('TOTAL DOWNLOADED')),
						rxTotal
					])
				]),
				E('div', { 'class': 'noc-traffic-stat-box box-tx' }, [
					E('div', {}, [
						E('div', { 'class': 'noc-traffic-stat-dir' }, _('CURRENT UPLOAD')),
						txRate
					]),
					E('div', { 'class': 'noc-traffic-stat-total' }, [
						E('div', {}, _('TOTAL UPLOADED')),
						txTotal
					])
				])
			]),
			E('div', { 'class': 'noc-chart-container' }, [
				trafficCanvas
			])
		]);

		window.addEventListener('resize', function() {
			self.drawTrafficChart(trafficCanvas, self.trafficHistory);
		});

		// Build Process Table Nodes
		var procTbody = E('tbody', {});
		this.domNodes.procTbody = procTbody;

		var tabMem = E('button', { 'class': 'noc-tab-btn' + (this.currentSort === 'mem' ? ' active' : '') }, 'MEM');
		var tabCpu = E('button', { 'class': 'noc-tab-btn' + (this.currentSort === 'cpu' ? ' active' : '') }, 'CPU');
		var tabNet = E('button', { 'class': 'noc-tab-btn' + (this.currentSort === 'net' ? ' active' : '') }, 'NET');

		function setSort(s) {
			self.currentSort = s;
			tabMem.className = 'noc-tab-btn' + (s === 'mem' ? ' active' : '');
			tabCpu.className = 'noc-tab-btn' + (s === 'cpu' ? ' active' : '');
			tabNet.className = 'noc-tab-btn' + (s === 'net' ? ' active' : '');
			if (self.lastProcData) {
				self.updateProcessTable(self.lastProcData);
			}
			self.refresh();
		}

		tabMem.onclick = function() { setSort('mem'); };
		tabCpu.onclick = function() { setSort('cpu'); };
		tabNet.onclick = function() { setSort('net'); };

		var processPanel = E('div', { 'class': 'noc-card' }, [
			E('div', { 'class': 'noc-card-header' }, [
				E('div', { 'class': 'noc-card-title' }, _('PROCESSES (HTOP)')),
				E('div', { 'class': 'noc-tab-group' }, [
					tabMem,
					tabCpu,
					tabNet
				])
			]),
			E('div', { 'class': 'noc-table-wrap' }, [
				E('table', { 'class': 'noc-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, _('PID')),
							E('th', {}, _('PROCESS')),
							E('th', {}, _('CPU%')),
							E('th', {}, _('RAM')),
							E('th', {}, _('NET'))
						])
					]),
					procTbody
				])
			])
		]);

		// Build Client Table Nodes
		var clientBadge = E('span', { 'class': 'noc-badge-value', 'style': 'font-size: 11px; color: var(--cyan);' }, '0 ' + _('ACTIVE'));
		var clientTbody = E('tbody', {});
		this.domNodes.clientBadge = clientBadge;
		this.domNodes.clientTbody = clientTbody;

		var clientPanel = E('div', { 'class': 'noc-card' }, [
			E('div', { 'class': 'noc-card-header' }, [
				E('div', { 'class': 'noc-card-title' }, _('CONNECTED CLIENTS')),
				clientBadge
			]),
			E('div', { 'class': 'noc-table-wrap' }, [
				E('table', { 'class': 'noc-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, _('HOST')),
							E('th', {}, _('IP ADDRESS')),
							E('th', {}, _('MAC ADDRESS')),
							E('th', {}, _('TRAFFIC (RX / TX)')),
							E('th', {}, _('TOTAL'))
						])
					]),
					clientTbody
				])
			])
		]);

		var twoColRow = E('div', { 'class': 'noc-two-col' }, [
			processPanel,
			clientPanel
		]);

		// Build Ports Panel Nodes
		var portMatrix = E('div', { 'class': 'noc-ports-matrix' });
		var portTbody = E('tbody', {});
		this.domNodes.portMatrix = portMatrix;
		this.domNodes.portTbody = portTbody;

		var portsPanel = E('div', { 'class': 'noc-card noc-ports-panel' }, [
			E('div', { 'class': 'noc-card-header' }, [
				E('div', { 'class': 'noc-card-title' }, _('PHYSICAL PORT MATRIX & LINK STATUS')),
				E('div', { 'class': 'noc-chart-legend' }, [
					E('div', { 'class': 'noc-legend-item' }, [
						E('div', { 'class': 'noc-led noc-led-link on', 'style': 'width:6px;height:6px;' }),
						_('LINK')
					]),
					E('div', { 'class': 'noc-legend-item' }, [
						E('div', { 'class': 'noc-led noc-led-act on', 'style': 'width:6px;height:6px;' }),
						_('ACTIVITY')
					])
				])
			]),
			portMatrix,
			E('div', { 'class': 'noc-table-wrap' }, [
				E('table', { 'class': 'noc-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, _('PORT')),
							E('th', {}, _('LINK')),
							E('th', {}, _('SPEED / DUPLEX')),
							E('th', {}, _('CURRENT RX')),
							E('th', {}, _('CURRENT TX')),
							E('th', {}, _('TOTAL RX')),
							E('th', {}, _('TOTAL TX'))
						])
					]),
					portTbody
				])
			])
		]);

		// Root wrapper
		var root = E('div', { 'class': 'dashboard-noc' }, [
			header,
			gaugeRow,
			trafficPanel,
			twoColRow,
			portsPanel
		]);

		// Populate initial DOM state
		this.updateDOM(data);

		// Register 5-second polling via LuCI's poll mechanism
		if (!this.pollRegistered) {
			poll.add(L.bind(this.refresh, this), 5);
			this.pollRegistered = true;
		}

		return root;
	}
});
