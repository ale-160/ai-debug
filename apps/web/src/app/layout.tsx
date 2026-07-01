import "./globals.css";
import { Toaster } from "sonner";
import React from "react";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "蛛网 · AI Debug —— 蛛网式上下文管理工具",
  description:
    "把 AI 对话从线性列表变成 git 仓库式的蛛网结构。每个分支独立维护自己的上下文路径，支持分叉、合并、放弃、恢复，让复杂问题的排查不再被无关历史污染。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          {children}
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
