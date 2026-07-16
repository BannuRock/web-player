import React from 'react';

export default function DeviceFrame({ children }) {
  return (
    <div className="device-frame-wrapper">
      {/* Real Phone Frame wrapper (only displays on desktop) */}
      <div className="phone-container">
        {/* Notch / Speaker */}
        <div className="phone-notch">
          <div className="speaker"></div>
          <div className="camera"></div>
        </div>
        
        {/* Buttons on the sides */}
        <div className="phone-button volume-up"></div>
        <div className="phone-button volume-down"></div>
        <div className="phone-button power"></div>
        
        {/* Phone screen itself */}
        <div className="phone-screen">
          {children}
        </div>
      </div>
      
      {/* Fallback full screen wrapper for mobile */}
      <div className="mobile-only-fullscreen">
        {children}
      </div>
    </div>
  );
}
