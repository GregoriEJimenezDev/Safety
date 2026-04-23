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
  const RD_BOUNDS = {
    latMin: 17.4,
    latMax: 20.2,
    lngMin: -72.1,
    lngMax: -68.1
  };

  const TYPE_META = {
    robbery: { label: "Atraco" },
    assault: { label: "Asalto" },
    theft: { label: "Robo" },
    vehicle: { label: "Robo vehiculo" }
  };

  const dom = {
    serverStatus: document.getElementById("serverStatus"),
    lastUpdated: document.getElementById("lastUpdated"),
    refreshBtn: document.getElementById("refreshBtn"),
    helpBtn: document.getElementById("helpBtn"),
    typeFilter: document.getElementById("typeFilter"),
    timeFilter: document.getElementById("timeFilter"),
    incidentList: document.getElementById("incidentList"),
    incidentCount: document.getElementById("incidentCount"),
    hotZoneList: document.getElementById("hotZoneList"),
    metricIncidents: document.getElementById("metricIncidents"),
    metricZones: document.getElementById("metricZones"),
    metricLast: document.getElementById("metricLast"),
    reportForm: document.getElementById("reportForm"),
    submitReportBtn: document.getElementById("submitReportBtn"),
    clearFormBtn: document.getElementById("clearFormBtn"),
    reportError: document.getElementById("reportError"),
    incidentType: document.getElementById("incidentType"),
    incidentDescription: document.getElementById("incidentDescription"),
    incidentSector: document.getElementById("incidentSector"),
    incidentDate: document.getElementById("incidentDate"),
    incidentLat: document.getElementById("incidentLat"),
    incidentLng: document.getElementById("incidentLng"),
    loginForm: document.getElementById("loginForm"),
    loginBtn: document.getElementById("loginBtn"),
    loginError: document.getElementById("loginError"),
    adminUser: document.getElementById("adminUser"),
    adminPass: document.getElementById("adminPass"),
    adminBadge: document.getElementById("adminBadge"),
    adminActions: document.getElementById("adminActions"),
    logoutBtn: document.getElementById("logoutBtn"),
    loadingOverlay: document.getElementById("loadingOverlay"),
    loadingText: document.getElementById("loadingText"),
    undoBar: document.getElementById("undoBar"),
    undoText: document.getElementById("undoText"),
    undoBtn: document.getElementById("undoBtn"),
    helpModal: document.getElementById("helpModal"),
    closeHelpBtn: document.getElementById("closeHelpBtn"),
    toast: document.getElementById("toast")
  };

  const state = {
    loadingCounter: 0,
    token: sessionStorage.getItem(TOKEN_KEY) || "",
    adminUser: null,
    currentIncidents: [],
    deleteUndo: null,
    online: navigator.onLine
  };

  let map;
  let markersLayer;
  let hotZoneLayer;
  let tempMarker;
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

    window.setTimeout(() => map.invalidateSize(), 120);
  }

  function bindEvents() {
    dom.typeFilter.addEventListener("change", () => {
      refreshAll().catch(handleError);
    });

    dom.timeFilter.addEventListener("change", () => {
      refreshAll().catch(handleError);
    });

    dom.refreshBtn.addEventListener("click", () => {
      refreshAll().catch(handleError);
    });

    dom.helpBtn.addEventListener("click", openHelp);
    dom.closeHelpBtn.addEventListener("click", closeHelp);

    dom.helpModal.addEventListener("click", (event) => {
      if (event.target === dom.helpModal) {
        closeHelp();
      }
    });

    dom.reportForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitReport().catch(handleError);
    });

    dom.clearFormBtn.addEventListener("click", clearReportForm);

    dom.loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      adminLogin().catch(handleError);
    });

    dom.logoutBtn.addEventListener("click", () => {
      state.token = "";
      state.adminUser = null;
      sessionStorage.removeItem(TOKEN_KEY);
      updateAdminUi();
      refreshAll().catch(handleError);
      showToast("Sesion cerrada");
    });

    dom.undoBtn.addEventListener("click", () => {
      undoDelete().catch(handleError);
    });

    window.addEventListener("keydown", onGlobalShortcuts);

    window.addEventListener("online", () => {
      state.online = true;
      showToast("Conexion recuperada.");
      refreshAll().catch(handleError);
    });

    window.addEventListener("offline", () => {
      state.online = false;
      renderOfflineStatus();
      showToast("Sin conexion. Mostrando el ultimo estado disponible.");
    });
  }

  function onGlobalShortcuts(event) {
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const isTyping = activeTag === "input" || activeTag === "textarea" || activeTag === "select";

    if (event.key === "Escape" && !dom.helpModal.classList.contains("hidden")) {
      closeHelp();
      return;
    }

    if (event.key === "?" || event.key === "F1") {
      event.preventDefault();
      openHelp();
      return;
    }

    if (!isTyping && event.altKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      refreshAll().catch(handleError);
    }
  }

  function initMap() {
    map = L.map("map", {
      center: RD_CENTER,
      zoom: 12,
      zoomControl: true
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 20
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    hotZoneLayer = L.layerGroup().addTo(map);

    map.on("click", (ev) => {
      dom.incidentLat.value = ev.latlng.lat.toFixed(5);
      dom.incidentLng.value = ev.latlng.lng.toFixed(5);
      clearFormError("report");

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
    if (!state.token) {
      updateAdminUi();
      return;
    }

    try {
      const data = await apiRequest(API.me, { token: state.token });
      state.adminUser = data.user;
    } catch {
      state.token = "";
      state.adminUser = null;
      sessionStorage.removeItem(TOKEN_KEY);
    }

    updateAdminUi();
  }

  async function refreshAll() {
    setLoading(true, "Actualizando incidentes...");

    try {
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

      state.currentIncidents = incidentsData.items || [];
      renderIncidents(state.currentIncidents);
      renderMarkers(state.currentIncidents);

      const zones = hotzonesData.items || [];
      renderHotzones(zones);
      renderMetrics(state.currentIncidents, zones);

      dom.lastUpdated.textContent = `Actualizado: ${formatDate(new Date().toISOString(), true)}`;
    } finally {
      setLoading(false);
    }
  }

  function renderServerStatus(health) {
    dom.serverStatus.classList.remove("is-loading", "is-offline");

    if (!state.online) {
      renderOfflineStatus();
      return;
    }

    dom.serverStatus.textContent = `Servidor activo | ${health.incidents} reportes totales`;
  }

  function renderOfflineStatus() {
    dom.serverStatus.textContent = "Sin conexion al servidor";
    dom.serverStatus.classList.add("is-offline");
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

      if (state.adminUser?.role === "admin") {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "delete-btn";
        deleteBtn.textContent = "Eliminar";
        deleteBtn.title = "Eliminar reporte y habilitar opcion deshacer";
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
    if (state.adminUser) {
      dom.adminBadge.textContent = `Autenticado: ${state.adminUser.username}`;
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
    clearFormError("report");

    const payload = {
      type: dom.incidentType.value,
      description: normalizeText(dom.incidentDescription.value, 120),
      sector: normalizeText(dom.incidentSector.value, 80),
      date: dom.incidentDate.value,
      lat: Number(dom.incidentLat.value),
      lng: Number(dom.incidentLng.value)
    };

    const reportError = validateReport(payload);
    if (reportError) {
      showFormError("report", reportError);
      return;
    }

    setButtonBusy(dom.submitReportBtn, true, "Guardando...");

    try {
      await apiRequest(API.incidents, {
        method: "POST",
        token: state.token,
        body: payload
      });

      clearReportForm();
      showToast("Reporte guardado.");
      await refreshAll();
    } finally {
      setButtonBusy(dom.submitReportBtn, false);
    }
  }

  function validateReport(payload) {
    if (!payload.type || !TYPE_META[payload.type]) return "Tipo de incidente invalido.";
    if (payload.description.length < 8) return "La descripcion debe tener al menos 8 caracteres.";
    if (payload.sector.length < 2) return "El sector debe tener al menos 2 caracteres.";
    if (!payload.date) return "Selecciona fecha y hora del incidente.";
    if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return "Selecciona coordenadas en el mapa.";

    if (!isWithinRD(payload.lat, payload.lng)) {
      return "Las coordenadas deben estar dentro de Republica Dominicana.";
    }

    const date = new Date(payload.date);
    if (Number.isNaN(date.getTime())) return "Fecha invalida.";
    if (date.getTime() > Date.now()) return "La fecha no puede estar en el futuro.";

    return "";
  }

  function clearReportForm() {
    dom.reportForm.reset();
    clearFormError("report");
    initDateDefault();

    if (tempMarker) {
      map.removeLayer(tempMarker);
      tempMarker = null;
    }
  }

  async function adminLogin() {
    clearFormError("login");

    const username = normalizeText(dom.adminUser.value, 40);
    const password = dom.adminPass.value;

    if (!username || !password) {
      showFormError("login", "Completa usuario y clave.");
      return;
    }

    setButtonBusy(dom.loginBtn, true, "Ingresando...");

    try {
      const data = await apiRequest(API.login, {
        method: "POST",
        body: { username, password }
      });

      state.token = data.token;
      sessionStorage.setItem(TOKEN_KEY, state.token);
      state.adminUser = data.user;
      dom.loginForm.reset();
      updateAdminUi();
      showToast("Sesion admin iniciada");
      await refreshAll();
    } finally {
      setButtonBusy(dom.loginBtn, false);
    }
  }

  async function deleteIncident(id) {
    if (!state.token) {
      showToast("Debes iniciar sesion como admin.");
      return;
    }

    const item = state.currentIncidents.find((incident) => incident.id === id);
    if (!item) {
      showToast("No se encontro el reporte a eliminar.");
      return;
    }

    const accepted = window.confirm(`Eliminar reporte "${item.description}"?`);
    if (!accepted) {
      return;
    }

    await apiRequest(`${API.incidents}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      token: state.token
    });

    showToast("Reporte eliminado. Puedes deshacer por 10 segundos.");
    startUndoWindow(item);
    await refreshAll();
  }

  function startUndoWindow(item) {
    clearUndoWindow();

    dom.undoText.textContent = "Reporte eliminado. Deshacer disponible por 10s.";
    dom.undoBar.classList.remove("hidden");

    const timeoutId = window.setTimeout(() => {
      clearUndoWindow();
    }, 10_000);

    state.deleteUndo = {
      item,
      timeoutId
    };
  }

  function clearUndoWindow() {
    if (state.deleteUndo?.timeoutId) {
      window.clearTimeout(state.deleteUndo.timeoutId);
    }

    state.deleteUndo = null;
    dom.undoBar.classList.add("hidden");
  }

  async function undoDelete() {
    if (!state.deleteUndo) {
      showToast("No hay accion para deshacer.");
      return;
    }

    const incident = state.deleteUndo.item;

    await apiRequest(API.incidents, {
      method: "POST",
      token: state.token,
      body: {
        type: incident.type,
        description: incident.description,
        sector: incident.sector,
        lat: incident.lat,
        lng: incident.lng,
        date: incident.date
      }
    });

    clearUndoWindow();
    showToast("Reporte restaurado.");
    await refreshAll();
  }

  function openHelp() {
    dom.helpModal.classList.remove("hidden");
  }

  function closeHelp() {
    dom.helpModal.classList.add("hidden");
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

  function setButtonBusy(button, busy, busyLabel = "Procesando...") {
    if (!button) return;

    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
      return;
    }

    const original = button.dataset.originalLabel;
    if (original) {
      button.textContent = original;
    }
    button.disabled = false;
  }

  function setLoading(on, message = "Actualizando datos...") {
    if (on) {
      state.loadingCounter += 1;
      dom.loadingText.textContent = message;
      dom.loadingOverlay.classList.remove("hidden");
      dom.serverStatus.classList.add("is-loading");
      dom.serverStatus.textContent = message;
      return;
    }

    state.loadingCounter = Math.max(0, state.loadingCounter - 1);
    if (state.loadingCounter === 0) {
      dom.loadingOverlay.classList.add("hidden");
      dom.serverStatus.classList.remove("is-loading");
    }
  }

  function showFormError(scope, message) {
    const target = scope === "login" ? dom.loginError : dom.reportError;
    if (!target) return;
    target.textContent = message;
    target.classList.remove("hidden");
  }

  function clearFormError(scope) {
    const target = scope === "login" ? dom.loginError : dom.reportError;
    if (!target) return;
    target.textContent = "";
    target.classList.add("hidden");
  }

  function isWithinRD(lat, lng) {
    return lat >= RD_BOUNDS.latMin && lat <= RD_BOUNDS.latMax && lng >= RD_BOUNDS.lngMin && lng <= RD_BOUNDS.lngMax;
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
    const msg = error?.message || "Ocurrio un error.";

    if (msg.toLowerCase().includes("credenciales")) {
      showFormError("login", msg);
    } else {
      showToast(msg);
    }
  }
})();
