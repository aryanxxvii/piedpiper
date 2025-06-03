
import React, { useState, useEffect } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from "@/components/ui/button";
import audioEngine from '@/utils/audioEngine';
import TimeElapsed from './TimeElapsed';

const MusicControls: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.4);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setIsPlaying(audioEngine.getIsPlaying());
    }, 100);
    
    return () => clearInterval(interval);
  }, []);
  
  const togglePlayback = async () => {
    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
    } else {
      try {
        audioEngine.generateNewPatterns();
        await audioEngine.start();
        setIsPlaying(true);
      } catch (error) {
        console.error("Failed to start audio:", error);
      }
    }
  };
  
  const handleVolumeBarClick = (e: React.MouseEvent<HTMLElement>, index?: number) => {
    let newVolume;
    if (typeof index === 'number') {
      const totalBars = 10;
      newVolume = Math.min(1, Math.max(0, (index + 1) / totalBars));
    } else {
      const volumeBar = e.currentTarget;
      const rect = volumeBar.getBoundingClientRect();
      const clickPosition = (e.clientX - rect.left) / rect.width;
      newVolume = Math.min(1, Math.max(0, clickPosition));
    }
    audioEngine.setVolume(newVolume);
    setVolume(newVolume);
  };

  const renderVolumeBar = () => {
    const totalBars = 10;
    const filledBars = Math.round(volume * totalBars);
    
    return (
      <div 
        className="flex items-center gap-1 cursor-pointer"
        onClick={handleVolumeBarClick}
      >
        {Array.from({ length: totalBars }).map((_, index) => (
          <span
            key={index}
            className={`text-sm font-mono ${
              index < filledBars ? 'text-text' : 'text-surface2'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              handleVolumeBarClick(e, index);
            }}
          >
            {index < filledBars ? '+' : '-'}
          </span>
        ))}
      </div>
    );
  };

  // Listen for volume changes from keyboard
  useEffect(() => {
    const updateVolume = () => {
      setVolume(audioEngine.getVolume());
    };
    
    const interval = setInterval(updateVolume, 100);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="fixed bottom-4 left-4 flex items-center gap-3 z-40">
      <Button 
        variant="outline" 
        size="sm" 
        onClick={togglePlayback}
        className="bg-[rgba(0,0,0,0)] hover:bg-[rgba(0,0,0,0)] hover:text-mauve border-none"
      >
        {isPlaying ? (
          <Pause size={16} />
        ) : (
          <Play size={16} />
        )}
      </Button>
      
      <div className="flex flex-col items-start gap-1 w-30">
        <div className='flex justify-between w-full'>
          <span className="text-sm text-subtext0 font-mono">VOL</span>
          <TimeElapsed/>
        </div>
        {renderVolumeBar()}
      </div>
    </div>
  );
};

export default MusicControls;
