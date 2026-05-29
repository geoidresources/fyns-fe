import React from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils"; // Assuming utils exists

interface LogoProps {
  className?: string;
  imageClassName?: string;
  href?: string;
}

export function Logo({ className, imageClassName, href = "/" }: LogoProps) {
  const content = (
    <div className={cn("flex items-center gap-3", className)}>
      <Image 
        src="/logo/geoid-logo-cropped.png" 
        alt="GEOID Logo" 
        width={120} 
        height={40} 
        className={cn("object-contain", imageClassName)}
        priority
      />
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center">
        {content}
      </Link>
    );
  }

  return content;
}
