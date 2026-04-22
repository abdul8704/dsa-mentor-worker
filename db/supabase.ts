import { createClient } from "@supabase/supabase-js"
import type { Database } from "../types/db.ts"
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || ""
const supabaseKey = process.env.SUPABASE_ROLE_KEY || ""

console.log("Supabase URL:", supabaseUrl)

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  }
});