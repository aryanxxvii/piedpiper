
import React from 'react';
import audioEngine from '@/utils/audioEngine';

const SeedDisplay: React.FC = () => {
  return (
    <div className="transform -translate-x-1/2 translate-y-8 z-30">
      <div className="bg-surface0 px-2 py-1 rounded text-xs text-subtext0 font-mono">
        seed: {audioEngine.getSeed()}
      </div>
    </div>
  );
};

export default SeedDisplay;
