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
  const MODE_KEY = "safemap_app_mode";
  const LOCAL_INCIDENTS_KEY = "safemap_local_incidents_v2";
  const LOCAL_ADMIN_KEY = "safemap_local_admin_v1";

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
    mode: sessionStorage.getItem(MODE_KEY) || "auto",
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

    await refreshAll();
    await verifySession();
    renderIncidents(state.currentIncidents);

    window.setTimeout(() => map.invalidateSize(), 120);
  }

  function bindEvents() {
    dom.typeFilter.addEventListener("change", () => refreshAll().catch(handleError));
    dom.timeFilter.addEventListener("change", () => refreshAll().catch(handleError));
    dom.refreshBtn.addEventListener("click", () => refreshAll().catch(handleError));

    dom.helpBtn.addEventListener("click", openHelp);
    dom.closeHelpBtn.addEventListener("click", closeHelp);
    dom.helpModal.addEventListener("click", (event) => {
      if (event.target === dom.helpModal) closeHelp();
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
      localStorage.removeItem(LOCAL_ADMIN_KEY);
      updateAdminUi();
      refreshAll().catch(handleError);
      showToast("Sesion cerrada");
    });

    dom.undoBtn.addEventListener("click", () => undoDelete().catch(handleError));

    window.addEventListener("keydown", onGlobalShortcuts);

    window.addEventListener("online", () => {
      state.online = true;
      showToast("Conexion recuperada.");
      refreshAll().catch(handleError);
    });

    window.addEventListener("offline", () => {
      state.online = false;
      renderServerStatus({ incidents: state.currentIncidents.length });
      showToast("Sin conexion. Se mantiene el ultimo estado cargado.");
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
    if (state.mode === "local") {
      const localAdmin = localStorage.getItem(LOCAL_ADMIN_KEY);
      if (localAdmin) {
        state.adminUser = { username: localAdmin, role: "admin" };
      } else {
        state.adminUser = null;
      }
      updateAdminUi();
      return;
    }

    if (!state.token) {
      state.adminUser = null;
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
      const data = await loadDataByMode();

      renderServerStatus({ incidents: data.totalIncidents });

      state.currentIncidents = data.incidents;
      renderIncidents(state.currentIncidents);
      renderMarkers(state.currentIncidents);
      renderHotzones(data.zones);
      renderMetrics(state.currentIncidents, data.zones);

      dom.lastUpdated.textContent = `Actualizado: ${formatDate(new Date().toISOString(), true)}`;

      await verifySession();
      renderIncidents(state.currentIncidents);
    } finally {
      setLoading(false);
    }
  }

  async function loadDataByMode() {
    const query = new URLSearchParams({
      type: dom.typeFilter.value,
      days: dom.timeFilter.value
    }).toString();

    if (state.mode !== "local") {
      try {
        const [health, incidentsData, hotzonesData] = await Promise.all([
          apiRequest(API.health),
          apiRequest(`${API.incidents}?${query}`),
          apiRequest(`${API.hotzones}?${query}`)
        ]);

        state.mode = "api";
        sessionStorage.setItem(MODE_KEY, state.mode);

        return {
          totalIncidents: health.incidents || 0,
          incidents: incidentsData.items || [],
          zones: hotzonesData.items || []
        };
      } catch {
        state.mode = "local";
        sessionStorage.setItem(MODE_KEY, state.mode);
        showToast("Servidor API no disponible. Se activo modo local.");
      }
    }

    const all = loadLocalIncidents();
    const incidents = filterIncidentsLocal(all, dom.typeFilter.value, dom.timeFilter.value);
    const zones = computeHotZones(incidents).slice(0, 8);

    return {
      totalIncidents: all.length,
      incidents,
      zones
    };
  }

  function loadLocalIncidents() {
    try {
      const raw = localStorage.getItem(LOCAL_INCIDENTS_KEY);
      if (!raw) {
        const seeded = buildSeedIncidents();
        localStorage.setItem(LOCAL_INCIDENTS_KEY, JSON.stringify(seeded));
        return seeded;
      }

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      console.error("Error loading local incidents", error);
    }

    const seeded = buildSeedIncidents();
    localStorage.setItem(LOCAL_INCIDENTS_KEY, JSON.stringify(seeded));
    return seeded;
  }

  function saveLocalIncidents(items) {
    localStorage.setItem(LOCAL_INCIDENTS_KEY, JSON.stringify(items));
  }

  function filterIncidentsLocal(all, type, days) {
    const now = Date.now();
    const sorted = [...all].sort((a, b) => new Date(b.date) - new Date(a.date));

    return sorted.filter((item) => {
      const typeMatch = type === "all" || item.type === type;
      if (!typeMatch) return false;

      if (days === "all") return true;
      const dayNum = Number(days);
      if (!Number.isFinite(dayNum)) return true;

      const age = now - new Date(item.date).getTime();
      return age >= 0 && age <= dayNum * 24 * 60 * 60 * 1000;
    });
  }

  function computeHotZones(items) {
    const grouped = new Map();

    for (const item of items) {
      const key = normalizeText(item.sector, 80).toLowerCase();
      const found = grouped.get(key) || {
        name: item.sector,
        count: 0,
        latSum: 0,
        lngSum: 0
      };

      found.count += 1;
      found.latSum += item.lat;
      found.lngSum += item.lng;
      grouped.set(key, found);
    }

    return Array.from(grouped.values())
      .filter((zone) => zone.count >= 2)
      .map((zone) => ({
        name: zone.name,
        count: zone.count,
        lat: Number((zone.latSum / zone.count).toFixed(5)),
        lng: Number((zone.lngSum / zone.count).toFixed(5)),
        risk: zone.count >= 5 ? "very-high" : zone.count >= 3 ? "high" : "medium"
      }))
      .sort((a, b) => b.count - a.count);
  }

  function renderServerStatus(health) {
    dom.serverStatus.classList.remove("is-loading", "is-offline");

    if (!state.online) {
      dom.serverStatus.textContent = "Sin conexion al servidor";
      dom.serverStatus.classList.add("is-offline");
      return;
    }

    if (state.mode === "local") {
      dom.serverStatus.textContent = `Modo local activo | ${health.incidents} reportes guardados`;
      dom.serverStatus.classList.add("is-offline");
      return;
    }

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
      const modeLabel = state.mode === "local" ? " (local)" : "";
      dom.adminBadge.textContent = `Autenticado: ${state.adminUser.username}${modeLabel}`;
      dom.adminBadge.classList.add("ok");
      dom.adminActions.classList.remove("hidden");
      dom.loginForm.classList.add("hidden");
    } else {
      dom.adminBadge.textContent = state.mode === "local" ? "No autenticado (modo local)" : "No autenticado";
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

    const error = validateReport(payload);
    if (error) {
      showFormError("report", error);
      return;
    }

    setButtonBusy(dom.submitReportBtn, true, "Guardando...");

    try {
      if (state.mode === "local") {
        const all = loadLocalIncidents();
        all.unshift({
          id: cryptoRandomId(),
          type: payload.type,
          description: payload.description,
          sector: payload.sector,
          lat: Number(payload.lat.toFixed(5)),
          lng: Number(payload.lng.toFixed(5)),
          date: new Date(payload.date).toISOString(),
          createdAt: new Date().toISOString(),
          reportedBy: state.adminUser?.username || "community"
        });
        saveLocalIncidents(all);
      } else {
        await apiRequest(API.incidents, {
          method: "POST",
          token: state.token,
          body: payload
        });
      }

      clearReportForm();
      showToast(state.mode === "local" ? "Reporte guardado en modo local." : "Reporte guardado.");
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
      if (state.mode === "local") {
        if (username.toLowerCase() === "admin" && password === "Cambia123!") {
          state.adminUser = { username: "admin", role: "admin" };
          localStorage.setItem(LOCAL_ADMIN_KEY, state.adminUser.username);
        } else {
          throw new Error("Credenciales invalidas en modo local. Usa admin / Cambia123!");
        }
      } else {
        const data = await apiRequest(API.login, {
          method: "POST",
          body: { username, password }
        });

        state.token = data.token;
        sessionStorage.setItem(TOKEN_KEY, state.token);
        state.adminUser = data.user;
      }

      dom.loginForm.reset();
      updateAdminUi();
      showToast("Sesion admin iniciada");
      await refreshAll();
    } finally {
      setButtonBusy(dom.loginBtn, false);
    }
  }

  async function deleteIncident(id) {
    if (!state.adminUser) {
      showToast("Debes iniciar sesion como admin.");
      return;
    }

    const item = state.currentIncidents.find((incident) => incident.id === id);
    if (!item) {
      showToast("No se encontro el reporte a eliminar.");
      return;
    }

    const accepted = window.confirm(`Eliminar reporte \"${item.description}\"?`);
    if (!accepted) return;

    if (state.mode === "local") {
      const all = loadLocalIncidents().filter((incident) => incident.id !== id);
      saveLocalIncidents(all);
    } else {
      await apiRequest(`${API.incidents}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        token: state.token
      });
    }

    startUndoWindow(item);
    showToast("Reporte eliminado. Puedes deshacer por 10 segundos.");
    await refreshAll();
  }

  function startUndoWindow(item) {
    clearUndoWindow();

    dom.undoText.textContent = "Reporte eliminado. Deshacer disponible por 10s.";
    dom.undoBar.classList.remove("hidden");

    const timeoutId = window.setTimeout(() => {
      clearUndoWindow();
    }, 10_000);

    state.deleteUndo = { item, timeoutId };
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

    if (state.mode === "local") {
      const all = loadLocalIncidents();
      all.unshift({
        id: cryptoRandomId(),
        type: incident.type,
        description: incident.description,
        sector: incident.sector,
        lat: incident.lat,
        lng: incident.lng,
        date: incident.date,
        createdAt: new Date().toISOString(),
        reportedBy: state.adminUser?.username || "admin"
      });
      saveLocalIncidents(all);
    } else {
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
    }

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
      html: `<span class=\"marker-pin marker-${type}\"></span>`,
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
    if (original) button.textContent = original;
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
    target.textContent = message;
    target.classList.remove("hidden");
  }

  function clearFormError(scope) {
    const target = scope === "login" ? dom.loginError : dom.reportError;
    target.textContent = "";
    target.classList.add("hidden");
  }

  function isWithinRD(lat, lng) {
    return lat >= RD_BOUNDS.latMin && lat <= RD_BOUNDS.latMax && lng >= RD_BOUNDS.lngMin && lng <= RD_BOUNDS.lngMax;
  }

  function cryptoRandomId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `id-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
      '\"': "&quot;",
      "'": "&#039;"
    };

    return String(value).replace(/[&<>\"']/g, (char) => map[char]);
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("show");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      dom.toast.classList.remove("show");
    }, 2800);
  }

  function handleError(error) {
    console.error(error);
    const msg = error?.message || "Ocurrio un error.";

    if (msg.toLowerCase().includes("credenciales")) {
      showFormError("login", msg);
      return;
    }

    showToast(msg);
  }

  function buildSeedIncidents() {
    const now = new Date();

    const daysAgoIso = (days, hour, minute) => {
      const date = new Date(now);
      date.setDate(now.getDate() - days);
      date.setHours(hour, minute, 0, 0);
      return date.toISOString();
    };

    return [
      { id: "seed-1", type: "robbery", description: "Despojo de celular en parada", sector: "Naco", lat: 18.4857, lng: -69.9341, date: daysAgoIso(1, 20, 30) },
      { id: "seed-2", type: "assault", description: "Asalto a peaton en avenida principal", sector: "Naco", lat: 18.4869, lng: -69.9314, date: daysAgoIso(3, 21, 10) },
      { id: "seed-3", type: "theft", description: "Robo de cartera en colmado", sector: "Gazcue", lat: 18.4679, lng: -69.9045, date: daysAgoIso(2, 19, 20) },
      { id: "seed-4", type: "vehicle", description: "Robo de motocicleta estacionada", sector: "Villa Juana", lat: 18.4941, lng: -69.9052, date: daysAgoIso(5, 23, 5) },
      { id: "seed-5", type: "robbery", description: "Atraco con arma blanca", sector: "Los Mina", lat: 18.5016, lng: -69.8653, date: daysAgoIso(4, 18, 15) },
      { id: "seed-6", type: "assault", description: "Intento de asalto en semaforo", sector: "Piantini", lat: 18.4769, lng: -69.9367, date: daysAgoIso(7, 22, 40) },
      { id: "seed-7", type: "robbery", description: "Robo a negocio pequeno", sector: "Piantini", lat: 18.4784, lng: -69.9381, date: daysAgoIso(10, 20, 50) },
      { id: "seed-8", type: "theft", description: "Sustraccion de pertenencias en vehiculo", sector: "Bella Vista", lat: 18.4556, lng: -69.9454, date: daysAgoIso(8, 17, 35) },
      { id: "seed-9", type: "vehicle", description: "Robo de retrovisores", sector: "Bella Vista", lat: 18.4571, lng: -69.9423, date: daysAgoIso(12, 21, 5) },
      { id: "seed-10", type: "robbery", description: "Asalto en banca de loteria", sector: "San Carlos", lat: 18.4739, lng: -69.9048, date: daysAgoIso(13, 19, 5) }
    ];
  }
})();
