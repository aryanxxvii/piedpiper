
import React, { useEffect } from "react";
import TodoList from "@/components/TodoList";
import MusicControls from "@/components/MusicControls";
import TimeElapsed from "@/components/TimeElapsed";
import { CoffeeAscii, SteamAscii } from "@/components/AsciiArt";
import audioEngine from "@/utils/audioEngine";

const Index = () => {
  useEffect(() => {
    // Clean up audio engine on unmount
    return () => {
      audioEngine.cleanup();
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-crust">
      <div className="fixed top-0 left-0 right-0 bottom-0 grid grid-cols-[repeat(40,1fr)] grid-rows-[repeat(25,1fr)] opacity-10 pointer-events-none">
        {Array.from({ length: 40 * 25 }).map((_, i) => (
          <div key={i} className="flex items-center justify-center text-[0.4rem] text-overlay0">
            {Math.random() > 0.98 ? "·" : ""}
          </div>
        ))}
      </div>
      
      <div className="container mx-auto px-4 flex items-center justify-center max-w-md">
        <TodoList />
      </div>
      
      <MusicControls />
      <TimeElapsed />
      
      {/* Animated Coffee Cup with Steam */}
      <div className="fixed bottom-4 right-4 z-40">
        <div className="relative">
          <CoffeeAscii />
          <SteamAscii 
            className="top-0 left-8 animate-steam" 
            animationDelay="0s"
          />
          <SteamAscii 
            className="top-0 left-10 animate-steam-alt" 
            animationDelay="0.5s"
          />
          <SteamAscii 
            className="top-0 left-6 animate-steam" 
            animationDelay="1s"
          />
        </div>
      </div>
    </div>
  );
};

export default Index;
