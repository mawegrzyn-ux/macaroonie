// src/areas/pepper.js
//
// The pepper area's route plugins (docs/claude/areas/pepper.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import mcpRoutes from '../routes/mcp.js'
import mcpOauthRoutes from '../routes/mcpOauth.js'
import aiRoutes from '../routes/ai.js'
import storeOpeningRoutes from '../routes/storeOpenings.js'
import menuImportRoutes from '../routes/menuImport.js'
import documentReadRoutes from '../routes/documentRead.js'
import aiApiRoutes from '../routes/aiApi.js'
import formDraftRoutes from '../routes/formDrafts.js'
import captureRoutes from '../routes/captures.js'
import plainFormRoutes from '../routes/plainForms.js'
import customFieldRoutes from '../routes/customFields.js'
import ruleRoutes from '../routes/rules.js'

export const routes = [
  // AI: MCP connectors (guest + staff) and the chats (migration 148)
  [mcpRoutes],
  [mcpOauthRoutes],
  [aiRoutes, { prefix: '/api/ai' }],
  [storeOpeningRoutes, { prefix: '/api/ai/store-openings' }],
  [menuImportRoutes, { prefix: '/api/ai/menus' }],
  [documentReadRoutes, { prefix: '/api/ai' }],
  [aiApiRoutes, { prefix: '/ai-api' }],
  // Form drafts (migration 275, Pepper-first step 3d)
  [formDraftRoutes, { prefix: '/api/form-drafts' }],
  // Capture to For review (migration 281, Pepper-first step 6b)
  [captureRoutes, { prefix: '/api/ai/captures' }],
  // The plain forms' fields, from their routes' schemas (Pepper-first step 8A3)
  [plainFormRoutes, { prefix: '/api/forms' }],
  // A group's own fields on customers, staff, suppliers and inventory items (migration 285, step 8B1)
  [customFieldRoutes, { prefix: '/api/custom-fields' }],
  // Rules made from a sentence (migration 286, step 8B2): under /api/ai/ for the model call
  [ruleRoutes, { prefix: '/api/ai/rules' }],
]
