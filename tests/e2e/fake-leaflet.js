// Stand-in for Leaflet (loaded from a CDN in production) so the live-map flow can be tested offline.
(function(){
  const log = window.__leaflet = { maps: 0, markers: [], views: [] };
  function Marker(p){ this.p = p; log.markers.push(this); }
  Marker.prototype.setLatLng = function(p){ this.p = p; return this; };
  Marker.prototype.addTo = function(){ return this; };
  Marker.prototype.remove = function(){};
  window.L = {
    map(el){ log.maps++; el.setAttribute('data-leaflet', '1'); return { setView(c){ log.views.push(c); return this; }, fitBounds(){ return this; }, invalidateSize(){ return this; }, remove(){} }; },
    tileLayer(){ return { addTo(){} }; }, marker(p){ return new Marker(p); }, divIcon(o){ return o; }, latLngBounds(p){ return p; },
  };
})();
