import { useState } from 'react';

export default function ResponsivePreviewer({ children }) {
  const [device, setDevice] = useState('full'); // full, desktop, tablet, mobile

  const dimensions = {
    full: { width: '100%', label: 'Full' },
    desktop: { width: '1280px', label: 'PC' },
    tablet: { width: '768px', label: 'Tablette' },
    mobile: { width: '375px', label: 'Phone' },
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Control Bar */}
      <div className="flex justify-center gap-2 p-2 bg-gray-900 border-b border-gray-700 z-[9999]">
        {Object.entries(dimensions).map(([key, { label }]) => (
          <button
            key={key}
            onClick={() => setDevice(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
              device === key ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Preview Container */}
      <div className="flex-1 bg-gray-200 overflow-auto flex justify-center p-4">
        <div 
          className="bg-white shadow-2xl transition-all duration-300 ease-in-out border border-gray-300"
          style={{ 
            width: dimensions[device].width,
            height: device === 'full' ? '100%' : '800px',
            margin: device === 'full' ? '0' : '0 auto',
            overflow: 'hidden'
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
