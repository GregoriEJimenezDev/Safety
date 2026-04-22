(() => {
  "use strict";

  const API = {
    health: "/api/health",
    incidents: "/api/incidents",
    hotzones: "/api/hotzones",
    login: "/api/auth/login",
    me: "/api/auth/me"
  };

  const TOKEN_KEY = "safemap_admin_token";
  const RD_CENTER = [18.4861, -69.9312];

  const TYPE_META = {
    robbery: { label: "Atraco" },
    assault: { label: "Asalto" },
    theft: { label: "Robo" },
    vehicle: { label: "Robo vehiculo" }
  };

  const dom = {
    serverStatus: document.getElementById("serverStatus"),
    typeFilter: document.getElementById("typeFilter"),
    timeFilter: document.getElementById("timeFilter"),
    incidentList: document.getElementById("incidentList"),
    incidentCount: document.getElementById("incidentCount"),
    hotZoneList: document.getElementById("hotZoneList"),
    metricIncidents: document.getElementById("metricIncidents"),
    metricZones: document.getElementById("metricZones"),
    metricLast: document.getElementById("metricLast"),
    reportForm: document.getElementById("reportForm"),
    incidentType: document.getElementById("incidentType"),
    incidentDescription: document.getElementById("incidentDescription"),
    incidentSector: document.getElementById("incidentSector"),
    incidentDate: document.getElementById("incidentDate"),
    incidentLat: document.getElementById("incidentLat"),
    incidentLng: document.getElementById("incidentLng"),
    loginForm: document.getElementById("loginForm"),
    adminUser: document.getElementById("adminUser"),
    adminPass: document.getElementById("adminPass"),
    adminBadge: document.getElementById("adminBadge"),
    adminActions: document.getElementById("adminActions"),
    logoutBtn: document.getElementById("logoutBtn"),
    toast: document.getElementById("toast")
  };

  let map;
  let markersLayer;
  let hotZoneLayer;
  let tempMarker;
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let adminUser = null;
  let currentIncidents = [];
  const markerById = new Map();

  init().catch((error) => {
    console.error(error);
    showToast("No se pudo inicializar la app.");
  });

  async function init() {
    initMap();
    initDateDefault();
    bindEvents();
    await verifySession();
    await refreshAll();

    window.setTimeout(() => map.invalidateSize(), 110);
  }

  function bindEvents() {
    dom.typeFilter.addEventListener("change", () => {
      refreshAll().catch(handleError);
    });

    dom.timeFilter.addEventListener("change", () => {
      refreshAll().catch(handleError);
    });

    dom.reportForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitReport().catch(handleError);
    });

    dom.loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      adminLogin().catch(handleError);
    });

    dom.logoutBtn.addEventListener("click", () => {
      token = "";
      adminUser = null;
      sessionStorage.removeItem(TOKEN_KEY);
      updateAdminUi();
      refreshAll().catch(handleError);
      showToast("Sesion cerrada");
    });
  }

  function initMap() {
    map = L.map("map", {
      center: RD_CENTER,
      zoom: 12,
      zoomControl: true
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 20
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    hotZoneLayer = L.layerGroup().addTo(map);

    map.on("click", (ev) => {
      dom.incidentLat.value = ev.latlng.lat.toFixed(5);
      dom.incidentLng.value = ev.latlng.lng.toFixed(5);

      if (tempMarker) {
        tempMarker.setLatLng(ev.latlng);
      } else {
        tempMarker = L.circleMarker(ev.latlng, {
          radius: 8,
          color: "#3ddc97",
          fillColor: "#3ddc97",
          fillOpacity: 0.72,
          weight: 2
        }).addTo(map);
      }
    });
  }

  function initDateDefault() {
    const now = new Date();
    const tzMs = now.getTimezoneOffset() * 60000;
    dom.incidentDate.value = new Date(now.getTime() - tzMs).toISOString().slice(0, 16);
  }

  async function verifySession() {
    if (!token) {
      updateAdminUi();
      return;
    }

    try {
      const data = await apiRequest(API.me, { token });
      adminUser = data.user;
    } catch {
      token = "";
      adminUser = null;
      sessionStorage.removeItem(TOKEN_KEY);
    }

    updateAdminUi();
  }

  async function refreshAll() {
    const query = new URLSearchParams({
      type: dom.typeFilter.value,
      days: dom.timeFilter.value
    }).toString();

    const [health, incidentsData, hotzonesData] = await Promise.all([
      apiRequest(API.health),
      apiRequest(`${API.incidents}?${query}`),
      apiRequest(`${API.hotzones}?${query}`)
    ]);

    renderServerStatus(health);

    currentIncidents = incidentsData.items || [];
    renderIncidents(currentIncidents);
    renderMarkers(currentIncidents);

    const zones = hotzonesData.items || [];
    renderHotzones(zones);
    renderMetrics(currentIncidents, zones);
  }

  function renderServerStatus(health) {
    dom.serverStatus.textContent = `Servidor activo | ${health.incidents} reportes totales`;
  }

  function renderIncidents(items) {
    dom.incidentList.innerHTML = "";
    dom.incidentCount.textContent = `${items.length} encontrados`;

    if (!items.length) {
      const p = document.createElement("p");
      p.className = "meta";
      p.textContent = "No hay incidentes con este filtro.";
      dom.incidentList.appendChild(p);
      return;
    }

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "incident-card";
      card.dataset.id = item.id;

      const top = document.createElement("div");
      top.className = "incident-card-top";

      const badge = document.createElement("span");
      badge.className = `badge badge-${item.type}`;
      badge.textContent = TYPE_META[item.type]?.label || item.type;
      top.appendChild(badge);

      if (adminUser?.role === "admin") {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "delete-btn";
        deleteBtn.textContent = "Eliminar";
        deleteBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          deleteIncident(item.id).catch(handleError);
        });
        top.appendChild(deleteBtn);
      }

      const title = document.createElement("h3");
      title.textContent = item.description;

      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = `${formatDate(item.date)} | ${item.sector} | ${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`;

      card.append(top, title, meta);
      card.addEventListener("click", () => focusIncident(item.id));
      dom.incidentList.appendChild(card);
    }
  }

  function renderMarkers(items) {
    markersLayer.clearLayers();
    markerById.clear();

    for (const item of items) {
      const marker = L.marker([item.lat, item.lng], {
        icon: buildMarkerIcon(item.type)
      }).addTo(markersLayer);

      marker.bindPopup(buildPopupHtml(item));
      markerById.set(item.id, marker);
    }
  }

  function renderHotzones(items) {
    hotZoneLayer.clearLayers();
    dom.hotZoneList.innerHTML = "";

    if (!items.length) {
      const li = document.createElement("li");
      li.textContent = "Sin zonas calientes para este filtro.";
      dom.hotZoneList.appendChild(li);
      return;
    }

    for (const zone of items) {
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.textContent = `${zone.name} (${zone.count})`;
      const right = document.createElement("span");
      right.className = `risk risk-${zone.risk}`;
      right.textContent = labelByRisk(zone.risk);
      li.append(left, right);
      dom.hotZoneList.appendChild(li);

      const color = colorByRisk(zone.risk);
      const circle = L.circle([zone.lat, zone.lng], {
        radius: 220 + zone.count * 130,
        color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2
      })
        .bindPopup(`<strong>${escapeHtml(zone.name)}</strong><br>${zone.count} incidentes`) 
        .addTo(hotZoneLayer);

      circle.on("click", () => {
        map.flyTo([zone.lat, zone.lng], 13, { duration: 0.6 });
      });
    }
  }

  function renderMetrics(incidents, zones) {
    dom.metricIncidents.textContent = String(incidents.length);
    dom.metricZones.textContent = String(zones.length);
    dom.metricLast.textContent = incidents[0] ? formatDate(incidents[0].date, true) : "--";
  }

  function updateAdminUi() {
    if (adminUser) {
      dom.adminBadge.textContent = `Autenticado: ${adminUser.username}`;
      dom.adminBadge.classList.add("ok");
      dom.adminActions.classList.remove("hidden");
      dom.loginForm.classList.add("hidden");
    } else {
      dom.adminBadge.textContent = "No autenticado";
      dom.adminBadge.classList.remove("ok");
      dom.adminActions.classList.add("hidden");
      dom.loginForm.classList.remove("hidden");
    }
  }

  async function submitReport() {
    const payload = {
      type: dom.incidentType.value,
      description: normalizeText(dom.incidentDescription.value, 120),
      sector: normalizeText(dom.incidentSector.value, 80),
      date: dom.incidentDate.value,
      lat: Number(dom.incidentLat.value),
      lng: Number(dom.incidentLng.value)
    };

    if (!payload.description || !payload.sector || !payload.date || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
      showToast("Completa todos los campos y selecciona coordenadas.");
      return;
    }

    await apiRequest(API.incidents, {
      method: "POST",
      token,
      body: payload
    });

    dom.reportForm.reset();
    initDateDefault();

    if (tempMarker) {
      map.removeLayer(tempMarker);
      tempMarker = null;
    }

    showToast("Reporte guardado.");
    await refreshAll();
  }

  async function adminLogin() {
    const username = normalizeText(dom.adminUser.value, 40);
    const password = dom.adminPass.value;

    if (!username || !password) {
      showToast("Completa usuario y clave.");
      return;
    }

    const data = await apiRequest(API.login, {
      method: "POST",
      body: { username, password }
    });

    token = data.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    adminUser = data.user;
    dom.loginForm.reset();
    updateAdminUi();
    showToast("Sesion admin iniciada");
    await refreshAll();
  }

  async function deleteIncident(id) {
    if (!token) {
      showToast("Debes iniciar sesion como admin.");
      return;
    }

    await apiRequest(`${API.incidents}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      token
    });

    showToast("Reporte eliminado");
    await refreshAll();
  }

  function focusIncident(id) {
    document.querySelectorAll(".incident-card.active").forEach((node) => node.classList.remove("active"));
    const card = document.querySelector(`.incident-card[data-id='${CSS.escape(id)}']`);
    if (card) card.classList.add("active");

    const marker = markerById.get(id);
    if (!marker) return;

    map.flyTo(marker.getLatLng(), 14, { duration: 0.6 });
    marker.openPopup();
  }

  function buildMarkerIcon(type) {
    return L.divIcon({
      className: "custom-marker-wrapper",
      html: `<span class="marker-pin marker-${type}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function buildPopupHtml(item) {
    const label = TYPE_META[item.type]?.label || item.type;
    return `<div><strong>${escapeHtml(label)}</strong><br>${escapeHtml(item.description)}<br><small>${escapeHtml(item.sector)} | ${formatDate(item.date)}</small></div>`;
  }

  function labelByRisk(risk) {
    if (risk === "very-high") return "Muy alta";
    if (risk === "high") return "Alta";
    return "Media";
  }

  function colorByRisk(risk) {
    if (risk === "very-high") return "#ff4d5e";
    if (risk === "high") return "#ff9f1a";
    return "#ffd43b";
  }

  async function apiRequest(url, options = {}) {
    const method = options.method || "GET";
    const headers = { "Content-Type": "application/json" };

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const errorMsg = data.error || `Error HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return data;
  }

  function formatDate(value, short = false) {
    const date = new Date(value);
    const format = short
      ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };
    return new Intl.DateTimeFormat("es-DO", format).format(date);
  }

  function normalizeText(text, maxLen) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
  }

  function escapeHtml(value) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return String(value).replace(/[&<>"']/g, (char) => map[char]);
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("show");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      dom.toast.classList.remove("show");
    }, 2600);
  }

  function handleError(error) {
    console.error(error);
    showToast(error.message || "Ocurrio un error.");
  }
})();
