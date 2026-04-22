(() => {
  "use strict";

  const STORAGE_KEY = "safemap_rd_incidents_v1";
  const RD_CENTER = [18.4861, -69.9312];
  const RD_BOUNDS = {
    latMin: 17.4,
    latMax: 20.2,
    lngMin: -72.1,
    lngMax: -68.1
  };

  const INCIDENT_META = {
    robbery: { label: "Atraco", color: "#ff4757" },
    assault: { label: "Asalto", color: "#ff9f1a" },
    theft: { label: "Robo", color: "#ffd43b" },
    vehicle: { label: "Robo vehiculo", color: "#2d9cff" }
  };

  const dom = {
    map: document.getElementById("map"),
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
    toast: document.getElementById("toast")
  };

  let incidents = loadIncidents();
  let map;
  let markersLayer;
  let hotZoneLayer;
  let tempMarker;
  const markerById = new Map();

  init();

  function init() {
    initMap();
    initFormDefaults();
    bindEvents();
    render();

    window.setTimeout(() => {
      map.invalidateSize();
    }, 120);
  }

  function initMap() {
    map = L.map(dom.map, {
      center: RD_CENTER,
      zoom: 12,
      zoomControl: true
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    hotZoneLayer = L.layerGroup().addTo(map);

    map.on("click", (ev) => {
      const { lat, lng } = ev.latlng;
      dom.incidentLat.value = lat.toFixed(5);
      dom.incidentLng.value = lng.toFixed(5);

      if (tempMarker) {
        tempMarker.setLatLng(ev.latlng);
      } else {
        tempMarker = L.circleMarker(ev.latlng, {
          radius: 8,
          color: "#3ddc97",
          fillColor: "#3ddc97",
          fillOpacity: 0.7,
          weight: 2
        }).addTo(map);
      }
    });
  }

  function bindEvents() {
    dom.typeFilter.addEventListener("change", render);
    dom.timeFilter.addEventListener("change", render);
    dom.reportForm.addEventListener("submit", onReportSubmit);
  }

  function onReportSubmit(event) {
    event.preventDefault();

    const type = dom.incidentType.value;
    const description = normalizeInput(dom.incidentDescription.value, 120);
    const sector = normalizeInput(dom.incidentSector.value, 80);
    const dateInput = dom.incidentDate.value;
    const lat = Number(dom.incidentLat.value);
    const lng = Number(dom.incidentLng.value);

    if (!description || !sector || !dateInput || Number.isNaN(lat) || Number.isNaN(lng)) {
      showToast("Completa todos los campos y marca el punto en el mapa.");
      return;
    }

    if (!isWithinDominicanRepublic(lat, lng)) {
      showToast("Las coordenadas deben pertenecer a Republica Dominicana.");
      return;
    }

    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime()) || date > new Date()) {
      showToast("La fecha no es valida o esta en el futuro.");
      return;
    }

    const newIncident = {
      id: cryptoRandomId(),
      type,
      description,
      sector,
      lat,
      lng,
      date: date.toISOString()
    };

    incidents.unshift(newIncident);
    saveIncidents(incidents);

    dom.reportForm.reset();
    initFormDefaults();

    if (tempMarker) {
      map.removeLayer(tempMarker);
      tempMarker = null;
    }

    render();
    map.flyTo([lat, lng], 14, { duration: 0.8 });
    showToast("Reporte guardado correctamente.");
  }

  function render() {
    const filtered = getFilteredIncidents();
    renderMarkers(filtered);
    const zones = renderHotZones(filtered);
    renderIncidentList(filtered);
    renderMetrics(filtered, zones);
  }

  function renderMarkers(list) {
    markersLayer.clearLayers();
    markerById.clear();

    list.forEach((incident) => {
      const marker = L.marker([incident.lat, incident.lng], {
        icon: buildMarkerIcon(incident.type)
      });

      marker
        .bindPopup(buildPopupHtml(incident), { closeButton: true })
        .addTo(markersLayer);

      markerById.set(incident.id, marker);
    });
  }

  function renderIncidentList(list) {
    dom.incidentList.innerHTML = "";
    dom.incidentCount.textContent = `${list.length} encontrados`;

    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "meta";
      empty.textContent = "No hay incidentes con ese filtro.";
      dom.incidentList.appendChild(empty);
      return;
    }

    list.forEach((incident) => {
      const card = document.createElement("article");
      card.className = "incident-card";
      card.dataset.id = incident.id;

      const badge = document.createElement("span");
      badge.className = `badge badge-${incident.type}`;
      badge.textContent = INCIDENT_META[incident.type].label;

      const title = document.createElement("h3");
      title.textContent = incident.description;

      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = `${formatDate(incident.date)} | ${incident.sector} | ${incident.lat.toFixed(4)}, ${incident.lng.toFixed(4)}`;

      card.append(badge, title, meta);

      card.addEventListener("click", () => {
        document.querySelectorAll(".incident-card.active").forEach((node) => node.classList.remove("active"));
        card.classList.add("active");

        const marker = markerById.get(incident.id);
        if (marker) {
          map.flyTo(marker.getLatLng(), 14, { duration: 0.6 });
          marker.openPopup();
        }
      });

      dom.incidentList.appendChild(card);
    });
  }

  function renderHotZones(list) {
    hotZoneLayer.clearLayers();
    dom.hotZoneList.innerHTML = "";

    const zones = computeZones(list);

    if (!zones.length) {
      const li = document.createElement("li");
      li.textContent = "Sin zonas calientes para este filtro.";
      dom.hotZoneList.appendChild(li);
      return zones;
    }

    zones.slice(0, 5).forEach((zone) => {
      const { riskLabel, riskClass, circleColor } = riskByCount(zone.count);

      const li = document.createElement("li");

      const left = document.createElement("span");
      left.textContent = `${capitalize(zone.name)} (${zone.count})`;

      const right = document.createElement("span");
      right.className = `risk ${riskClass}`;
      right.textContent = riskLabel;

      li.append(left, right);
      dom.hotZoneList.appendChild(li);

      const circle = L.circle([zone.lat, zone.lng], {
        radius: 200 + zone.count * 120,
        color: circleColor,
        fillColor: circleColor,
        fillOpacity: 0.15,
        weight: 2
      })
        .bindPopup(`<strong>${escapeHtml(capitalize(zone.name))}</strong><br>${zone.count} incidentes recientes`) 
        .addTo(hotZoneLayer);

      circle.on("click", () => {
        map.flyTo(circle.getLatLng(), 13, { duration: 0.7 });
      });
    });

    return zones;
  }

  function renderMetrics(list, zones) {
    dom.metricIncidents.textContent = String(list.length);
    dom.metricZones.textContent = String(zones.length);

    const lastIncident = list[0];
    dom.metricLast.textContent = lastIncident ? formatDate(lastIncident.date, true) : "--";
  }

  function getFilteredIncidents() {
    const type = dom.typeFilter.value;
    const timeRange = dom.timeFilter.value;
    const now = Date.now();

    const sorted = [...incidents].sort((a, b) => new Date(b.date) - new Date(a.date));

    return sorted.filter((item) => {
      const typeMatch = type === "all" || item.type === type;

      let timeMatch = true;
      if (timeRange !== "all") {
        const ageMs = now - new Date(item.date).getTime();
        const dayMs = Number(timeRange) * 24 * 60 * 60 * 1000;
        timeMatch = ageMs <= dayMs;
      }

      return typeMatch && timeMatch;
    });
  }

  function computeZones(list) {
    const grouped = new Map();

    list.forEach((incident) => {
      const key = incident.sector.trim().toLowerCase();
      const found = grouped.get(key) || {
        name: incident.sector,
        count: 0,
        latSum: 0,
        lngSum: 0
      };

      found.count += 1;
      found.latSum += incident.lat;
      found.lngSum += incident.lng;
      grouped.set(key, found);
    });

    return Array.from(grouped.values())
      .filter((zone) => zone.count >= 2)
      .map((zone) => ({
        name: zone.name,
        count: zone.count,
        lat: zone.latSum / zone.count,
        lng: zone.lngSum / zone.count
      }))
      .sort((a, b) => b.count - a.count);
  }

  function buildPopupHtml(incident) {
    const label = INCIDENT_META[incident.type].label;
    return `
      <div>
        <strong>${escapeHtml(label)}</strong><br>
        ${escapeHtml(incident.description)}<br>
        <small>${escapeHtml(incident.sector)} - ${formatDate(incident.date)}</small>
      </div>
    `;
  }

  function buildMarkerIcon(type) {
    return L.divIcon({
      className: "custom-marker-wrapper",
      html: `<span class="marker-pin marker-${type}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function riskByCount(count) {
    if (count >= 5) {
      return { riskLabel: "Muy alta", riskClass: "risk-high", circleColor: "#ff4757" };
    }

    if (count >= 3) {
      return { riskLabel: "Alta", riskClass: "risk-medium", circleColor: "#ff9f1a" };
    }

    return { riskLabel: "Media", riskClass: "risk-low", circleColor: "#ffd43b" };
  }

  function initFormDefaults() {
    const now = new Date();
    const tzMs = now.getTimezoneOffset() * 60000;
    dom.incidentDate.value = new Date(now.getTime() - tzMs).toISOString().slice(0, 16);
    dom.incidentLat.value = "";
    dom.incidentLng.value = "";
  }

  function normalizeInput(value, maxLen) {
    return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
  }

  function isWithinDominicanRepublic(lat, lng) {
    return (
      lat >= RD_BOUNDS.latMin &&
      lat <= RD_BOUNDS.latMax &&
      lng >= RD_BOUNDS.lngMin &&
      lng <= RD_BOUNDS.lngMax
    );
  }

  function formatDate(dateValue, short = false) {
    const date = new Date(dateValue);
    const options = short
      ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

    return new Intl.DateTimeFormat("es-DO", options).format(date);
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("show");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      dom.toast.classList.remove("show");
    }, 2600);
  }

  function cryptoRandomId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `id-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  function escapeHtml(value) {
    const mapChars = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return String(value).replace(/[&<>"']/g, (char) => mapChars[char]);
  }

  function capitalize(text) {
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function loadIncidents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seeded = buildSeedIncidents();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
        return seeded;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("Invalid storage shape");
      }

      return parsed;
    } catch (error) {
      console.error("Error loading incidents", error);
      return buildSeedIncidents();
    }
  }

  function saveIncidents(payload) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
      { id: "seed-10", type: "robbery", description: "Asalto en banca de loteria", sector: "San Carlos", lat: 18.4739, lng: -69.9048, date: daysAgoIso(13, 19, 5) },
      { id: "seed-11", type: "assault", description: "Asalto a delivery", sector: "Ensanche Ozama", lat: 18.5005, lng: -69.8784, date: daysAgoIso(17, 20, 15) },
      { id: "seed-12", type: "theft", description: "Robo de bolso en terminal", sector: "Santiago Centro", lat: 19.4515, lng: -70.6970, date: daysAgoIso(19, 18, 55) },
      { id: "seed-13", type: "robbery", description: "Atraco en calle oscura", sector: "Santiago Centro", lat: 19.4530, lng: -70.6942, date: daysAgoIso(20, 22, 25) },
      { id: "seed-14", type: "vehicle", description: "Robo de piezas de vehiculo", sector: "San Cristobal Centro", lat: 18.4171, lng: -70.1075, date: daysAgoIso(24, 21, 45) }
    ];
  }
})();
