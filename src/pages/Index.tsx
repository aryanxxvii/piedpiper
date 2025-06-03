
import React, { useEffect } from "react";
import MusicPlayer from "@/components/MusicPlayer";
import audioEngine from "@/utils/audioEngine";

const Index = () => {
  useEffect(() => {
    // Clean up audio engine on unmount
    return () => {
      audioEngine.cleanup();
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-crust bg-[radial-gradient(ellipse_at_center,rgba(180,190,254,0.1),transparent)] bg-fixed">
      <div className="fixed top-0 left-0 right-0 bottom-0 grid grid-cols-[repeat(40,1fr)] grid-rows-[repeat(25,1fr)] opacity-10 pointer-events-none">
        {Array.from({ length: 40 * 25 }).map((_, i) => (
          <div key={i} className="flex items-center justify-center text-[0.4rem] text-overlay0">
            {Math.random() > 0.98 ? "·" : ""}
          </div>
        ))}
      </div>
      <MusicPlayer />
    </div>
  );
};

export default Index;
