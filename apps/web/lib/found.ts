import { AppError } from "@pew/db";
import { notFound } from "next/navigation";

/** Map a service-layer not_found (wrong id or wrong product) to the 404 page. */
export async function found<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  }
}
