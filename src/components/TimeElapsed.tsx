import React, { useState, useEffect } from 'react';
import audioEngine from '@/utils/audioEngine';

type TimeDisplayMode = 'elapsed' | 'current';

const TimeElapsed: React.FC = () => {
  const [elapsed, setElapsed] = useState(0);
  const [displayMode, setDisplayMode] = useState<TimeDisplayMode>('elapsed');
  const [currentTime, setCurrentTime] = useState<string>('');

  // Update elapsed time when playing
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioEngine.getIsPlaying()) {
        setElapsed(prev => prev + 1);
      }
      
      // Always update current time
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const toggleDisplayMode = () => {
    setDisplayMode(prev => prev === 'elapsed' ? 'current' : 'elapsed');
  };

  return (
    <div className="cursor-pointer" onClick={toggleDisplayMode}>
      <div className="rounded text-sm text-subtext0 font-mono">
        {displayMode === 'elapsed' ? formatTime(elapsed) : currentTime}
      </div>
    </div>
  );
};

export default TimeElapsed;
