"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, EyeOffIcon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

const signUpSchema = z.object({
  fullName: z.string().min(2, { message: "Name must be at least 2 characters" }),
  email: z.string().email({ message: "Invalid email address" }),
  company: z.string().min(2, { message: "Company name is required" }),
  password: z.string().min(8, { message: "Minimum 8 characters" }),
});

type SignUpFormValues = z.infer<typeof signUpSchema>;

export default function SignUpPage() {
  const [showPassword, setShowPassword] = React.useState(false);
  
  const { register, handleSubmit, formState: { errors } } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
  });

  // No self-serve signup exists: user-svc has no public register endpoint
  // (/user/signup returns 401 "Authorization is required" — invite/admin only).
  // Never log the form (it holds a plaintext password); tell the user the truth.
  const onSubmit = () => {
    toast.info(
      "Self-serve signup isn't available yet — contact your GEOID administrator or sales to get an account."
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Create your account</h1>
        <p className="text-[#9CA3AF]">Start your 14-day free trial.</p>
      </div>

      <div className="rounded-lg border border-[#C97A4E]/30 bg-[#C97A4E]/10 px-4 py-3 text-sm text-[#E5B99A]">
        Accounts are provisioned by invitation. Contact your GEOID administrator
        or sales to get access — self-serve signup isn&apos;t available yet.
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <div>
          <Input
            type="text"
            placeholder="Your full name"
            autoComplete="name"
            {...register("fullName")}
            className="h-14 bg-[#16181D] border-white/5 placeholder:text-[#6B7280]"
          />
          {errors.fullName && <p className="text-red-400 text-sm mt-1">{errors.fullName.message}</p>}
        </div>

        <div>
          <Input
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            {...register("email")}
            className="h-14 bg-[#16181D] border-white/5 placeholder:text-[#6B7280]"
          />
          {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email.message}</p>}
        </div>

        <div>
          <Input
            type="text"
            placeholder="Company or organization name"
            autoComplete="organization"
            {...register("company")}
            className="h-14 bg-[#16181D] border-white/5 placeholder:text-[#6B7280]"
          />
          {errors.company && <p className="text-red-400 text-sm mt-1">{errors.company.message}</p>}
        </div>

        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            {...register("password")}
            className="h-14 bg-[#16181D] border-white/5 placeholder:text-[#6B7280] pr-12"
          />
          <button 
            type="button" 
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#9CA3AF]"
          >
            <HugeiconsIcon icon={EyeIcon} altIcon={EyeOffIcon} showAlt={showPassword} size={20} color="#6B7280" />
          </button>
          {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password.message}</p>}
        </div>

        <Button type="submit" size="lg" className="h-14 mt-2">Create account</Button>
      </form>

      <div className="relative flex items-center py-2">
        <div className="flex-grow border-t border-white/5"></div>
        <span className="flex-shrink-0 mx-4 text-[#6B7280] text-sm">or continue with</span>
        <div className="flex-grow border-t border-white/5"></div>
      </div>

      {/* SSO isn't wired up yet — disabled rather than dead. */}
      <div className="flex gap-4">
        <Button variant="secondary" disabled title="SSO coming soon" className="flex-1 h-12 gap-2 bg-[#16181D]">
          <Image src="/icons/google.svg" width={16} height={16} alt="Google" />
          Google
        </Button>
        <Button variant="secondary" disabled title="SSO coming soon" className="flex-1 h-12 gap-2 bg-[#16181D]">
          <Image src="/icons/microsoft.svg" width={16} height={16} alt="Microsoft" />
          Microsoft
        </Button>
      </div>

      <div className="text-center mt-6">
        <p className="text-sm text-[#9CA3AF] mb-4">
          Already have an account? <Link href="/sign-in" className="text-[#818CF8] hover:text-[#A5B4FC] transition-colors">Sign in</Link>
        </p>
        <p className="text-xs text-[#6B7280]">
          By creating an account you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
