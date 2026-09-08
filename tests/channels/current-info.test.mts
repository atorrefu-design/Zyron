import assert from "node:assert/strict";
import test from "node:test";
import { directCurrentInfoQuery } from "../../lib/channels/current-info.ts";

test("explicit Telegram web requests use the single-call current information route", () => {
  const request = "Consulta la web de la federación catalana de básquet cuántos equipos tiene esta temporada la Fundación Brafa";
  assert.equal(directCurrentInfoQuery(request), request);
  assert.equal(directCurrentInfoQuery("Busca en internet las noticias de hoy"), "Busca en internet las noticias de hoy");
});

test("ordinary conversation and memory queries stay in their own routes", () => {
  assert.equal(directCurrentInfoQuery("Hola Zyron"), null);
  assert.equal(directCurrentInfoQuery("Qué recuerdas de Eloy"), null);
  assert.equal(directCurrentInfoQuery("Crea una tarea para mañana"), null);
});
