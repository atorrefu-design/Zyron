import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "ZYRON Private Memory API",
      version: "1.0.0",
      description: "Memoria portátil y privada de Aarón. Todos los datos requieren una sesión autorizada de ZYRON.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "ZYRON owner session" },
      },
      schemas: {
        MemoryBlock: {
          type: "object",
          properties: {
            id: { type: "string" },
            document_id: { type: "string" },
            heading: { type: "string" },
            section_path: { type: "string" },
            content: { type: "string" },
            score: { type: "number" },
          },
        },
      },
    },
    paths: {
      "/api/auth/native-login": {
        post: {
          summary: "Obtener una sesión privada de 30 días",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["key"], properties: { key: { type: "string" } } } } } },
          responses: { "200": { description: "Token Bearer" }, "401": { description: "Clave incorrecta" } },
        },
      },
      "/api/memory": {
        get: { summary: "Estado y documentos de memoria", security: [{ bearerAuth: [] }], responses: { "200": { description: "Estado de la memoria" } } },
        post: {
          summary: "Guardar una memoria explícita",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["content"], properties: { content: { type: "string" }, heading: { type: "string" }, source: { type: "string" } } } } } },
          responses: { "201": { description: "Memoria guardada" } },
        },
      },
      "/api/memory/search": {
        get: {
          summary: "Buscar bloques relevantes",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 30, default: 8 } },
          ],
          responses: { "200": { description: "Bloques ordenados por relevancia" } },
        },
      },
      "/api/memory/context": {
        post: {
          summary: "Construir contexto listo para otro modelo o aplicación",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string" }, maxCharacters: { type: "integer", minimum: 2000, maximum: 50000 } } } } } },
          responses: { "200": { description: "Contexto y bloques utilizados" } },
        },
      },
      "/api/memory/import": {
        post: {
          summary: "Importar o actualizar un documento Markdown",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["markdown"], properties: { documentId: { type: "string" }, title: { type: "string" }, version: { type: "string" }, markdown: { type: "string" } } } } } },
          responses: { "200": { description: "Documento sin cambios" }, "201": { description: "Documento importado" } },
        },
      },
      "/api/memory/export": {
        get: { summary: "Exportar toda la memoria como JSON", security: [{ bearerAuth: [] }], responses: { "200": { description: "Copia portátil de la memoria" } } },
      },
    },
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
