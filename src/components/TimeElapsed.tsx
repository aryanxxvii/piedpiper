
import React, { useState, useEffect } from 'react';
import audioEngine from '@/utils/audioEngine';

const TimeElapsed: React.FC = () => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (audioEngine.getIsPlaying()) {
        setElapsed(prev => prev + 1);
      }
    }, 1000);

    // Reset when music stops
    const checkPlayingInterval = setInterval(() => {
      if (!audioEngine.getIsPlaying()) {
        setElapsed(0);
      }
    }, 100);

    return () => {
      clearInterval(interval);
      clearInterval(checkPlayingInterval);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-40">
      <div className="bg-surface0 px-3 py-1 rounded text-sm text-subtext0 font-mono">
        {formatTime(elapsed)}
      </div>
    </div>
  );
};

export default TimeElapsed;
