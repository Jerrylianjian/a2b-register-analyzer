/* Estimate chamber setpoint from a phase-start or terminal observation in the Script log clock. */
const A2BTemperature = (() => {
  const HIGH=105, LOW=-40, RATE=4;
  const MIN=60_000, HOLD=90*MIN, RAMP=(HIGH-LOW)*MIN/RATE, PERIOD=2*(HOLD+RAMP);
  const phases=[
    {key:"high",label:"高温保持",offset:0,duration:HOLD,from:HIGH,to:HIGH},
    {key:"cool",label:"降温",offset:HOLD,duration:RAMP,from:HIGH,to:LOW},
    {key:"low",label:"低温保持",offset:HOLD+RAMP,duration:HOLD,from:LOW,to:LOW},
    {key:"warm",label:"升温",offset:2*HOLD+RAMP,duration:RAMP,from:LOW,to:HIGH}
  ];
  function terminalOffset(phase,temperature,holdMinutes){
    const p=phases.find(x=>x.key===phase);
    if(!p || !Number.isFinite(temperature) || temperature<LOW || temperature>HIGH) return null;
    if(p.from===p.to){
      if(temperature!==p.from || !Number.isFinite(holdMinutes) || holdMinutes<0 || holdMinutes*MIN>HOLD) return null;
      return p.offset+holdMinutes*MIN;
    }
    return p.offset+p.duration*(temperature-p.from)/(p.to-p.from);
  }
  function estimate(time,profile){
    if(!profile || !Number.isFinite(time) || !Number.isFinite(profile.anchor)) return null;
    const backwards=profile.direction==="backward";
    const start=phases.find(x=>x.key===profile.phase);
    if(!start) return null;
    if(backwards ? time>profile.anchor || (Number.isFinite(profile.limit) && time<profile.limit)
                 : time<profile.anchor || (Number.isFinite(profile.end) && time>profile.end)) return null;
    const offset=backwards?terminalOffset(profile.phase,profile.terminalTemperature,profile.holdMinutes):start.offset;
    if(offset===null) return null;
    if(backwards && time===profile.anchor){
      return {value:Math.round(profile.terminalTemperature*10)/10,phase:start.label};
    }
    const shifted=time-profile.anchor+offset;
    const within=((shifted%PERIOD)+PERIOD)%PERIOD;
    const p=phases.find(x=>within<x.offset+x.duration);
    const raw=p.from+(p.to-p.from)*(within-p.offset)/p.duration;
    return {value:Math.round(raw*10)/10,phase:p.label};
  }
  return Object.freeze({HIGH,LOW,RATE,HOLD,RAMP,PERIOD,terminalOffset,estimate});
})();
if(typeof module==="object"&&module.exports) module.exports=A2BTemperature;
