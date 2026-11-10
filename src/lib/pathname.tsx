import { createContext, useContext } from "react";

export const PathnameContext = createContext("/");
export const usePathname = () => useContext(PathnameContext);
