
import React,{useState,useRef} from 'react';
import {MapContainer,TileLayer,Marker,Popup,Polyline,useMapEvents} from 'react-leaflet';
import axios from 'axios';
import L from 'leaflet';

// Import leaflet marker images to resolve bundler path issues
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Custom icons using Leaflet's divIcon
const startIcon = L.divIcon({
  className: 'custom-start-marker',
  html: `<div style="background-color: #3B82F6; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const endIcon = L.divIcon({
  className: 'custom-end-marker',
  html: `<div style="background-color: #EF4444; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const getBusinessIcon = (tags) => {
  const isRestaurant = tags.amenity === 'restaurant';
  const emoji = isRestaurant ? '🍔' : '🛍️';
  const bgColor = isRestaurant ? '#F59E0B' : '#10B981'; // Amber/Orange for restaurant, Emerald for shop

  return L.divIcon({
    className: 'custom-business-marker',
    html: `<div style="
      background-color: ${bgColor}; 
      width: 28px; 
      height: 28px; 
      border-radius: 50%; 
      border: 2px solid white; 
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    ">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
};

const currentLocIcon = L.divIcon({
  className: 'gps-marker',
  html: '<div class="gps-dot"></div><div class="gps-pulse"></div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});




// Fallback helper extractors for OSM tags
const getPhone = (tags) => {
  if (!tags) return null;
  return tags.phone || tags['contact:phone'] || tags.mobile || tags['contact:mobile'] || tags['phone:mobile'] || null;
};

const getWebsite = (tags) => {
  if (!tags) return null;
  let url = tags.website || tags['contact:website'] || tags.url || tags['contact:url'] || null;
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
};

const getAddress = (tags) => {
  if (!tags) return null;
  const parts = [];
  if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);
  if (tags['addr:street']) parts.push(tags['addr:street']);
  if (tags['addr:suburb']) parts.push(tags['addr:suburb']);
  if (tags['addr:city']) parts.push(tags['addr:city']);
  if (parts.length > 0) return parts.join(', ');
  return tags['addr:full'] || null;
};

const getGoogleSearchUrl = (s) => {
  const name = s.tags?.name || 'Business';
  const category = s.tags?.shop || s.tags?.amenity || '';
  const city = s.tags?.['addr:city'] || '';
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} ${category} ${city}`)}`;
};

function Picker({onPick}){
  useMapEvents({click:e=>onPick(e.latlng)});
  return null;
}

export default function App(){
 const [start,setStart]=useState(null);
 const [end,setEnd]=useState(null);
 const [route,setRoute]=useState([]);
 const [shops,setShops]=useState([]);
 const [isLoading,setIsLoading]=useState(false);
 const [loadingStatus,setLoadingStatus]=useState('');
 const [map,setMap]=useState(null);
 const [currentLocation,setCurrentLocation]=useState(null);
 const [isModalOpen,setIsModalOpen]=useState(false);
 const markerRefs=useRef({});

 const openGoogleMapsNewTab=(s)=>{
    const name = s.tags?.name || 'Business';
    const query = `${name}`;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${s.lat},${s.lon},17z`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

 const pick=(p)=>{
   if(!start) setStart(p);
   else if(!end) setEnd(p);
   else { setStart(p); setEnd(null); setRoute([]); setShops([]); }
 };

 const goToCurrentLocation = () => {
   if (!navigator.geolocation) {
     alert("Geolocation is not supported by your browser");
     return;
   }
   
   navigator.geolocation.getCurrentPosition(
     (position) => {
       const lat = position.coords.latitude;
       const lng = position.coords.longitude;
       const coords = [lat, lng];
       setCurrentLocation(coords);
       if (map) {
         map.setView(coords, 15, { animate: true });
       }
     },
     (error) => {
       console.error("Error getting geolocation:", error);
       alert("Unable to retrieve your location. Make sure location permissions are enabled.");
     }
   );
 };

  const getRoute=async()=>{
    try {
      setIsLoading(true);
      setLoadingStatus('Calculating route path...');
      const API_KEY=process.env.REACT_APP_API_KEY;
      if (!API_KEY) {
        alert("API Key is missing. Please make sure the .env file exists in the project root directory and contains REACT_APP_API_KEY, and restart the development server.");
        setIsLoading(false);
        return;
      }
      const url=`https://api.openrouteservice.org/v2/directions/driving-car?api_key=${API_KEY}&start=${start.lng},${start.lat}&end=${end.lng},${end.lat}`;
      const res=await axios.get(url);
      const coords=res.data.features[0].geometry.coordinates.map(c=>[c[1],c[0]]);
      setRoute(coords);

      setLoadingStatus('Searching for local businesses...');
      // Sample up to 35 points evenly distributed across the entire route
      const numPoints = 35;
      const step = Math.max(1, Math.floor(coords.length / numPoints));
      const sampled = [];
      for (let i = 0; i < coords.length; i += step) {
        sampled.push(coords[i]);
      }

      if (sampled.length > 0) {
        const queryParts = sampled.map(p => `node["shop"](around:100,${p[0]},${p[1]});node["amenity"="restaurant"](around:100,${p[0]},${p[1]});`);
        const query = `[out:json][timeout:15];(${queryParts.join('')});out;`;
        
        const OVERPASS_SERVERS = [
          'https://overpass-api.de/api/interpreter',
          'https://lz4.overpass-api.de/api/interpreter',
          'https://z.overpass-api.de/api/interpreter',
          'https://overpass.kumi.systems/api/interpreter'
        ];

        let resData = null;
        let lastError = null;

        for (const serverUrl of OVERPASS_SERVERS) {
          try {
            console.log(`Querying Overpass server: ${serverUrl}`);
            const r = await axios.post(serverUrl, query, {
              headers: { 'Content-Type': 'text/plain' },
              timeout: 10000 // 10-second timeout per server request
            });
            resData = r.data;
            break; // Success! Exit loop
          } catch (e) {
            console.warn(`Overpass server ${serverUrl} failed:`, e.message);
            lastError = e;
          }
        }

        if (!resData) {
          throw new Error(`All Overpass API servers failed or timed out. Last error: ${lastError?.message || 'Unknown'}`);
        }

        const unique = Array.from(new Map(resData.elements.map(x => [x.id, x])).values());
        setShops(unique);
      } else {
        setShops([]);
      }
    } catch (error) {
      console.error("Error finding route & businesses:", error);
      alert("Failed to find route & businesses. Details: " + (error.response?.data?.error?.message || error.message));
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const locateBusiness = (s) => {
    if (map) {
      map.setView([s.lat, s.lon], 16, { animate: true });
      const marker = markerRefs.current[s.id];
      if (marker) {
        marker.openPopup();
      }
    }
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>🗺️ Route Finder</h1>
          <p>Find shops and food along your drive</p>
        </div>
        
        <div className="sidebar-content">
          <div className="card">
            <div className="card-title">📍 Selection Points</div>
            <div className="point-row">
              <div className="point-dot start"></div>
              <div className="point-info" style={{ flex: 1, textAlign: 'left' }}>
                <span className="point-label">START POINT</span>
                <span className="point-value" style={{ display: 'block' }}>
                  {start ? `${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}` : 'Click map to select'}
                </span>
              </div>
              {currentLocation && !start && (
                <button 
                  onClick={() => setStart({ lat: currentLocation[0], lng: currentLocation[1] })}
                  style={{
                    fontSize: '11px',
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    color: '#818cf8',
                    border: 'none',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Use GPS
                </button>
              )}
            </div>
            <div className="point-row">
              <div className="point-dot end"></div>
              <div className="point-info" style={{ flex: 1, textAlign: 'left' }}>
                <span className="point-label">DESTINATION POINT</span>
                <span className="point-value" style={{ display: 'block' }}>
                  {end ? `${end.lat.toFixed(5)}, ${end.lng.toFixed(5)}` : 'Click map to select'}
                </span>
              </div>
            </div>
          </div>

          <button 
            className="btn-primary" 
            disabled={!start || !end || isLoading} 
            onClick={getRoute}
          >
            {isLoading ? 'Processing...' : 'Find Route & Businesses'}
          </button>

          {isLoading && (
            <div className="loading-container">
              <div className="spinner"></div>
              <div className="loading-text">{loadingStatus}</div>
            </div>
          )}

          {!isLoading && shops.length > 0 && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <span>🏪 Businesses Found ({shops.length})</span>
                <button className="expand-btn" onClick={() => setIsModalOpen(true)}>
                  Expand ↗
                </button>
              </div>
              <div className="business-list">
                {shops.map(s => {
                  const isRestaurant = s.tags?.amenity === 'restaurant';
                  const typeLabel = s.tags?.shop || s.tags?.amenity || 'business';
                  return (
                    <div 
                      key={s.id} 
                      className="business-item"
                      onClick={() => locateBusiness(s)}
                    >
                      <div className="business-item-header">
                        <span className="business-name">{s.tags?.name || 'Unnamed Business'}</span>
                        <span className={`business-badge ${isRestaurant ? 'restaurant' : 'shop'}`}>
                          {isRestaurant ? '🍔 Food' : '🛍️ Shop'}
                        </span>
                      </div>
                      <div className="business-meta">
                        <span style={{ textTransform: 'capitalize' }}>Type: {typeLabel}</span>
                        {getPhone(s.tags) && <span>📞 {getPhone(s.tags)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isLoading && shops.length === 0 && route.length > 0 && (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
              No businesses found along this route. Try a different route!
            </div>
          )}

          <div className="card" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div className="card-title" style={{ marginBottom: '6px' }}>💡 Quick Guide</div>
            <ol className="instructions-list">
              <li>Click anywhere on the map to set your <strong>Start</strong> point.</li>
              <li>Click another spot to set your <strong>Destination</strong>.</li>
              <li>Click the button above to calculate the path and search for places nearby.</li>
              <li>A third click on the map will reset and start over.</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="map-container-wrapper">
        <MapContainer 
          ref={setMap}
          center={[17.385, 78.4867]} 
          zoom={13} 
          className="map-container"
        >
          <TileLayer 
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          <Picker onPick={pick}/>
          {currentLocation && <Marker position={currentLocation} icon={currentLocIcon}/>}
          {start && <Marker position={start} icon={startIcon}/>}
          {end && <Marker position={end} icon={endIcon}/>}
          {route.length > 0 && <Polyline positions={route} pathOptions={{ color: '#6366f1', weight: 4, opacity: 0.8 }}/>}
          {shops.map(s => (
            <Marker 
              key={s.id} 
              position={[s.lat, s.lon]} 
              icon={getBusinessIcon(s.tags || {})}
              ref={ref => {
                if (ref) {
                  markerRefs.current[s.id] = ref;
                } else {
                  delete markerRefs.current[s.id];
                }
              }}
            >
              <Popup>
                <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', minWidth: '220px', padding: '2px' }}>
                  <h3 style={{ margin: '0 0 4px 0', color: '#f8fafc', fontSize: '15px', fontWeight: '700' }}>
                    {s.tags?.name || 'Unnamed Business'}
                  </h3>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ 
                      display: 'inline-block', 
                      backgroundColor: '#334155', 
                      color: '#cbd5e1', 
                      fontSize: '11px', 
                      fontWeight: '600',
                      padding: '2px 8px', 
                      borderRadius: '12px', 
                      textTransform: 'capitalize'
                    }}>
                      {s.tags?.shop || s.tags?.amenity || 'Business'}
                    </span>
                  </div>
                  
                  <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {getPhone(s.tags) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>📞</span>
                        <a href={`tel:${getPhone(s.tags)}`} style={{ color: '#818cf8', textDecoration: 'none', fontWeight: '500' }}>
                          {getPhone(s.tags)}
                        </a>
                      </div>
                    )}
                    {getWebsite(s.tags) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>🌐</span>
                        <a href={getWebsite(s.tags)} target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: '500' }}>
                          Visit Website
                        </a>
                      </div>
                    )}
                    {s.tags?.opening_hours && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                        <span>⏰</span>
                        <span>{s.tags.opening_hours}</span>
                      </div>
                    )}
                    {getAddress(s.tags) && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                        <span>📍</span>
                        <span>{getAddress(s.tags)}</span>
                      </div>
                    )}
                    {!getPhone(s.tags) && !getWebsite(s.tags) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                        <span style={{ fontStyle: 'italic', color: '#64748b' }}>No contact details in OSM</span>
                        <button 
                          onClick={() => openGoogleMapsNewTab(s)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: '#818cf8',
                            textDecoration: 'underline',
                            fontWeight: '600',
                            fontSize: '11px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            textAlign: 'left'
                          }}
                        >
                          🗺️ View on Google Maps ↗
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        <button 
          className="current-location-btn" 
          onClick={goToCurrentLocation} 
          title="Center on Current Location"
        >
          🎯
        </button>
      </div>
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🏪 Businesses Found along the Route ({shops.length})</h2>
              <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="business-grid">
                {shops.map(s => {
                  const isRestaurant = s.tags?.amenity === 'restaurant';
                  const typeLabel = s.tags?.shop || s.tags?.amenity || 'business';
                  return (
                    <div key={s.id} className="modal-business-card">
                      <div>
                        <div className="modal-business-card-header" style={{ marginBottom: '8px' }}>
                          <span className="modal-business-card-name" style={{ display: 'block', marginBottom: '4px' }}>
                            {s.tags?.name || 'Unnamed Business'}
                          </span>
                          <span className={`business-badge ${isRestaurant ? 'restaurant' : 'shop'}`}>
                            {isRestaurant ? '🍔 Food' : '🛍️ Shop'}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'capitalize' }}>
                          Type: {typeLabel}
                        </div>
                        <div className="modal-business-card-details">
                          {getPhone(s.tags) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>📞</span>
                              <a href={`tel:${getPhone(s.tags)}`} style={{ color: '#818cf8', textDecoration: 'none', fontWeight: '500' }}>
                                {getPhone(s.tags)}
                              </a>
                            </div>
                          )}
                          {getWebsite(s.tags) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>🌐</span>
                              <a href={getWebsite(s.tags)} target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: '500' }}>
                                Visit Website
                              </a>
                            </div>
                          )}
                          {s.tags?.opening_hours && (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                              <span>⏰</span>
                              <span>{s.tags.opening_hours}</span>
                            </div>
                          )}
                          {getAddress(s.tags) && (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                              <span>📍</span>
                              <span>{getAddress(s.tags)}</span>
                            </div>
                          )}
                          {!getPhone(s.tags) && !getWebsite(s.tags) && !s.tags?.opening_hours && !getAddress(s.tags) && (
                            <span style={{ fontStyle: 'italic', color: '#64748b' }}>No contact details in OSM</span>
                          )}
                        </div>
                      </div>
                      <div className="modal-business-card-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button 
                          className="modal-btn locate" 
                          onClick={() => {
                            locateBusiness(s);
                            setIsModalOpen(false);
                          }}
                        >
                          Locate on Map
                        </button>
                        {!getPhone(s.tags) && !getWebsite(s.tags) && (
                          <button 
                            onClick={() => openGoogleMapsNewTab(s)}
                            className="modal-btn secondary"
                          >
                            🗺️ Google Maps ↗
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
