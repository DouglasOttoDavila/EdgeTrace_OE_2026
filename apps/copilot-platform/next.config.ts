import path from "node:path";
import dotenv from "dotenv";
import type { NextConfig } from "next";

const repoRoot = path.resolve(process.cwd(), "..", "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const publicTestrailBaseUrl = (
  process.env.NEXT_PUBLIC_TESTRAIL_BASE_URL ||
  process.env.TESTRAIL_BASE_URL ||
  process.env.TESTRAIL_URL ||
  ""
).trim();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_TESTRAIL_BASE_URL: publicTestrailBaseUrl
  }
};

export default nextConfig;