import React from "react";
import { Menu, Globe, Map, BarChart2, Upload, FolderOpen, FileText, Settings, HelpCircle } from "lucide-react";
import Link from "next/link";

export function Sidebar() {
  return (
    <div className="w-16 h-full bg-[#12141A] border-r border-[#1E2028] flex flex-col items-center py-4 z-20">
      <button className="text-gray-400 hover:text-gray-200 mb-8 transition-colors">
        <Menu size={24} color="#C97A4E" />
      </button>

      <div className="flex flex-col gap-6 w-full items-center">
        <SidebarItem icon={<Globe size={22} />} active href="/globe" />
        <SidebarItem icon={<Map size={22} />} href="#" />
        <SidebarItem icon={<BarChart2 size={22} />} href="#" />
        <SidebarItem icon={<Upload size={22} />} href="/upload" />
        <SidebarItem icon={<FolderOpen size={22} />} href="#" />
        <SidebarItem icon={<FileText size={22} />} href="#" />
      </div>

      <div className="mt-auto flex flex-col gap-6 w-full items-center mb-4">
        <SidebarItem icon={<Settings size={22} />} href="#" />
        <SidebarItem icon={<HelpCircle size={22} />} href="#" />
      </div>
    </div>
  );
}

function SidebarItem({ icon, active, href }: { icon: React.ReactNode; active?: boolean; href: string }) {
  return (
    <Link href={href} className="relative group w-full flex justify-center">
      <div
        className={`p-2 rounded-lg transition-colors ${
          active ? "text-[#C97A4E]" : "text-gray-500 hover:text-gray-300"
        }`}
      >
        {icon}
      </div>
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#C97A4E] rounded-r-md" />
      )}
    </Link>
  );
}
