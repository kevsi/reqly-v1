"use client";

import { createContext, useContext } from "react";

export interface AiSidebarContextType {
  aiSidebarOpen: boolean;
  setAiSidebarOpen: (open: boolean) => void;
}

export const AiSidebarContext = createContext<AiSidebarContextType>({
  aiSidebarOpen: false,
  setAiSidebarOpen: () => {},
});

export const useAiSidebar = () => useContext(AiSidebarContext);
