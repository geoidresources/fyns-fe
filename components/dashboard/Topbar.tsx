import Image from "next/image";
import { Search, Bell } from "lucide-react";

export function Topbar() {
  return (
    <div className="h-16 border-b border-[#1E2028] bg-[#0A0D14] flex items-center justify-between px-6 shrink-0 z-10 relative">
      <div className="flex items-center">
        <Image 
          src="/geoid-logo-cropped.png" 
          alt="Geoid" 
          width={80} 
          height={20} 
          className="object-contain w-auto h-auto"
        />
      </div>

      <div className="flex-1 flex justify-center px-8">
        <div className="relative w-full max-w-lg">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search sites, surveys, features... ⌘K"
            className="w-full bg-[#12141A] border border-[#1E2028] rounded-full py-2 pl-10 pr-4 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-[#C97A4E] transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="text-gray-400 hover:text-gray-200 transition-colors">
          <Bell size={20} />
        </button>
        <button className="w-8 h-8 rounded-full bg-[#2A2D35] flex items-center justify-center text-sm font-medium text-gray-200 hover:bg-[#343741] transition-colors">
          PD
        </button>
      </div>
    </div>
  );
}
