import { apiFetch, resolveServiceBase } from "@/lib/api/client";
import type { AuthClient, AuthUser } from "@/lib/auth";

// user-svc client — identity + projects. Base URL is env-driven; routes live
// under /user-svc/api/v1.

const BASE = resolveServiceBase(
  process.env.NEXT_PUBLIC_USER_SVC_URL,
  "/user-svc/api/v1",
  "NEXT_PUBLIC_USER_SVC_URL",
  "http://localhost:8081"
);

export interface LoginResponse {
  token: string;
  expire_at: number;
  user: AuthUser;
  client: AuthClient;
  is_onboarded?: boolean;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  lifecycle_status: string;
  center_lat: number | null;
  center_lng: number | null;
  center_height: number | null;
  location_name: string | null;
  crs_epsg: number | null;
  crs_label: string | null;
  crs_units: string | null;
  vertical_datum: string | null;
  primary_material: string | null;
  created_at: string;
  updated_at: string;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>(BASE, "/user/login", {
    method: "POST",
    body: { email, password },
    noAuth: true,
  });
}

export function listProjects(): Promise<Project[]> {
  return apiFetch<Project[]>(BASE, "/project");
}

export function getProject(id: string): Promise<Project> {
  return apiFetch<Project>(BASE, `/project/${id}`);
}

/** Body for POST /project — mirrors user-svc dtos.CreateProjectRequest.
 * Geo/CRS fields are optional; asset-svc snapshots crs_epsg/vertical_datum
 * onto each new survey as its working CRS. */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  location_name?: string;
  crs_epsg?: number;
  crs_label?: string;
  vertical_datum?: string;
  primary_material?: string;
}

export function createProject(req: CreateProjectRequest): Promise<Project> {
  return apiFetch<Project>(BASE, "/project", { method: "POST", body: req });
}
