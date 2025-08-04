// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// server/storage.ts
var MemStorage = class {
  users;
  consultationRequests;
  currentUserId;
  currentConsultationId;
  constructor() {
    this.users = /* @__PURE__ */ new Map();
    this.consultationRequests = /* @__PURE__ */ new Map();
    this.currentUserId = 1;
    this.currentConsultationId = 1;
  }
  async getUser(id) {
    return this.users.get(id);
  }
  async getUserByUsername(username) {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }
  async createUser(insertUser) {
    const id = this.currentUserId++;
    const user = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
  async createConsultationRequest(request) {
    const id = this.currentConsultationId++;
    const consultationRequest = {
      ...request,
      id,
      message: request.message || null,
      createdAt: /* @__PURE__ */ new Date()
    };
    this.consultationRequests.set(id, consultationRequest);
    return consultationRequest;
  }
  async getConsultationRequests() {
    return Array.from(this.consultationRequests.values());
  }
};
var storage = new MemStorage();

// shared/schema.ts
import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var consultationRequests = pgTable("consultation_requests", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  serviceInterest: text("service_interest").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var insertConsultationRequestSchema = createInsertSchema(consultationRequests).omit({
  id: true,
  createdAt: true
});

// server/routes.ts
import { z } from "zod";

// server/openai.ts
import OpenAI from "openai";
var openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function generateCareerRecommendations(assessmentData) {
  try {
    const prompt = `You are a senior talent acquisition expert with 10+ years of experience in the startup and tech industry. Analyze the following career assessment and provide 3-4 personalized career path recommendations.

Assessment Data:
- Current Role: ${assessmentData.currentRole}
- Experience Level: ${assessmentData.experience}
- Industry: ${assessmentData.industry}
- Skills: ${assessmentData.skills.join(", ")}
- Interests: ${assessmentData.interests.join(", ")}
- Career Goals: ${assessmentData.careerGoals}
- Desired Timeframe: ${assessmentData.timeframe}
- Location: ${assessmentData.location}
- Work Style: ${assessmentData.workStyle}

Provide recommendations in JSON format with this exact structure:
{
  "recommendations": [
    {
      "title": "Specific Job Title",
      "description": "2-3 sentence description of the role and why it fits",
      "skillsNeeded": ["skill1", "skill2", "skill3"],
      "timeToTransition": "realistic timeframe (e.g., '6-12 months', '1-2 years')",
      "salaryRange": "realistic range for their location (e.g., '\u20B915-25 LPA', '$80-120k')",
      "growthPotential": "brief description of career growth prospects",
      "nextSteps": ["specific action 1", "specific action 2", "specific action 3"],
      "reasoning": "2-3 sentences explaining why this path aligns with their profile"
    }
  ]
}

Focus on:
- Realistic career transitions based on their current background
- Actionable next steps they can take immediately
- Honest assessment of time and effort required
- Consider the startup/tech ecosystem in their location
- Provide diverse options (not all the same type of role)`;
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert career advisor and talent acquisition specialist. Provide practical, actionable career guidance based on real market insights."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2e3
    });
    const result = JSON.parse(response.choices[0].message.content || '{"recommendations": []}');
    return result.recommendations || [];
  } catch (error) {
    console.error("Error generating career recommendations:", error);
    if (error instanceof Error && (error.message.includes("quota") || error.message.includes("429"))) {
      throw new Error("OpenAI API quota exceeded. Please check your OpenAI billing and usage limits.");
    }
    throw new Error("Failed to generate career recommendations. Please try again.");
  }
}

// server/routes.ts
async function registerRoutes(app2) {
  app2.post("/api/consultation", async (req, res) => {
    try {
      const validatedData = insertConsultationRequestSchema.parse(req.body);
      const consultationRequest = await storage.createConsultationRequest(validatedData);
      console.log("New consultation request:", consultationRequest);
      res.json({
        message: "Consultation request submitted successfully",
        id: consultationRequest.id
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          message: "Validation error",
          errors: error.errors
        });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });
  app2.get("/api/consultation", async (req, res) => {
    try {
      const requests = await storage.getConsultationRequests();
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  const assessmentSchema = z.object({
    currentRole: z.string().min(1),
    experience: z.string().min(1),
    industry: z.string().min(1),
    skills: z.array(z.string()).min(1),
    interests: z.array(z.string()).min(1),
    careerGoals: z.string().min(1),
    timeframe: z.string().min(1),
    location: z.string().min(1),
    workStyle: z.string().min(1)
  });
  app2.post("/api/career-recommendations", async (req, res) => {
    try {
      const validatedData = assessmentSchema.parse(req.body);
      const recommendations = await generateCareerRecommendations(validatedData);
      res.json({ recommendations });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          message: "Validation error",
          errors: error.errors
        });
      } else {
        console.error("Career recommendations error:", error);
        res.status(500).json({
          message: "Failed to generate recommendations. Please try again."
        });
      }
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = 5e3;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
