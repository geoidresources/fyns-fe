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
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { login } from "@/lib/api/userSvc";
import { setSession } from "@/lib/auth";

const signInSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }),
  remember: z.boolean().optional(),
});

type SignInFormValues = z.infer<typeof signInSchema>;

export default function SignInPage() {
  const [showPassword, setShowPassword] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const router = useRouter();
  
  const { register, handleSubmit, formState: { errors } } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
  });

  const onSubmit = async (data: SignInFormValues) => {
    setIsLoading(true);
    try {
      const result = await login(data.email, data.password);

      // Shared JWT for both user-svc and asset-svc clients
      setSession(result, data.remember);

      toast.success("Successfully logged in!");
      router.push("/globe");
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("An unexpected error occurred during sign in.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Sign in to GEOID</h1>
        <p className="text-[#9CA3AF]">Welcome back. Enter your credentials to continue.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <div>
          <Input 
            type="email" 
            placeholder="you@company.com" 
            {...register("email")}
            className="h-14 bg-[#16181D] border-white/5 placeholder:text-[#6B7280]"
          />
          {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email.message}</p>}
        </div>

        <div className="relative">
          <Input 
            type={showPassword ? "text" : "password"} 
            placeholder="Enter your password" 
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

        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" {...register("remember")} />
            <div className="w-11 h-6 bg-[#2A2D35] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#9CA3AF] peer-checked:after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#C97A4E]"></div>
            <span className="ml-3 text-sm font-medium text-[#9CA3AF]">Remember me</span>
          </label>
        </div>

        <Button type="submit" size="lg" className="h-14 mt-2" disabled={isLoading}>
          {isLoading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="relative flex items-center py-2">
        <div className="flex-grow border-t border-white/5"></div>
        <span className="flex-shrink-0 mx-4 text-[#6B7280] text-sm">or continue with</span>
        <div className="flex-grow border-t border-white/5"></div>
      </div>

      <div className="flex gap-4">
        <Button variant="secondary" className="flex-1 h-12 gap-2 bg-[#16181D]">
          <Image src="/icons/google.svg" width={16} height={16} alt="Google" />
          Google
        </Button>
        <Button variant="secondary" className="flex-1 h-12 gap-2 bg-[#16181D]">
          <Image src="/icons/microsoft.svg" width={16} height={16} alt="Microsoft" />
          Microsoft
        </Button>
      </div>

      <div className="text-center mt-4">
        <Link href="#" className="text-sm text-[#818CF8] hover:text-[#A5B4FC] transition-colors mb-6 inline-block">Forgot password?</Link>
        <p className="text-sm text-[#9CA3AF]">
          Don&apos;t have an account? <Link href="/sign-up" className="text-[#818CF8] hover:text-[#A5B4FC] transition-colors">Start free trial</Link>
        </p>
      </div>
    </div>
  );
}
