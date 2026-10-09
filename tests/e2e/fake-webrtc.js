// Stand-ins for the browser's microphone and WebRTC so call logic can be tested headlessly (no real audio).
(function(){
  window.__beeps=0;
  window.AudioContext=function(){ this.currentTime=0; this.destination={}; this.createGain=()=>({gain:{value:0},connect(){}}); this.createOscillator=()=>({frequency:{value:0},connect(){},start(){window.__beeps++;},stop(){}}); };
  window.__tracks=[]; window.__pcs=[];
  navigator.mediaDevices.getUserMedia=async()=>{ const tr={enabled:true,stopped:false,stop(){this.stopped=true;}}; window.__tracks.push(tr); return {getTracks:()=>[tr],getAudioTracks:()=>[tr]}; };
  window.RTCPeerConnection=function(cfg){
    const pc=this; window.__pcs.push(pc); pc.cfg=cfg; pc.localDescription=null; pc.remoteDescription=null; pc.connectionState='new'; pc.closed=false;
    pc.addTrack=()=>{}; pc.addIceCandidate=async()=>{}; pc.close=()=>{ pc.closed=true; pc.connectionState='closed'; };
    pc.createOffer=async()=>({type:'offer',sdp:'fake-offer'}); pc.createAnswer=async()=>({type:'answer',sdp:'fake-answer'});
    const maybe=()=>{ if(pc.localDescription&&pc.remoteDescription&&pc.connectionState==='new'){ setTimeout(()=>{ pc.connectionState='connected'; pc.onconnectionstatechange&&pc.onconnectionstatechange(); },100); } };
    pc.setLocalDescription=async d=>{ pc.localDescription=d; if(pc.onicecandidate) setTimeout(()=>pc.onicecandidate({candidate:{candidate:'candidate:1 1 udp 1 1.2.3.4 5 typ host'}}),10); maybe(); };
    pc.setRemoteDescription=async d=>{ pc.remoteDescription=d; maybe(); };
  };
})();
