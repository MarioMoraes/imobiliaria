import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRentSchedule } from "./rent-schedule.js";

/** Regra pura: não precisa de banco nem de infra de pé. */

test("gera uma parcela por mês do prazo, no valor do aluguel", () => {
  const parcelas = buildRentSchedule({
    startsAt: "2026-08-01",
    endsAt: "2027-07-31",
    termMonths: 12,
    tenantPayDay: 10,
    rentalValueCents: 250_000,
  });

  assert.equal(parcelas.length, 12);
  assert.ok(parcelas.every((p) => p.amountCents === 250_000));
  assert.equal(parcelas[0]?.dueDate, "2026-08-10");
  assert.equal(parcelas[0]?.competence, "2026-08");
  assert.equal(parcelas[0]?.description, "Aluguel 1/12");
  assert.equal(parcelas[11]?.dueDate, "2027-07-10");
  assert.equal(new Set(parcelas.map((p) => p.competence)).size, 12, "competências únicas");
});

test("a 1ª parcela vai para o mês seguinte quando o dia de pagamento já passou", () => {
  const parcelas = buildRentSchedule({
    startsAt: "2026-08-20",
    endsAt: null,
    termMonths: 3,
    tenantPayDay: 5,
    rentalValueCents: 100_000,
  });

  assert.deepEqual(
    parcelas.map((p) => p.dueDate),
    ["2026-09-05", "2026-10-05", "2026-11-05"],
  );
});

test("dia 31 cai no último dia dos meses curtos", () => {
  const parcelas = buildRentSchedule({
    startsAt: "2026-01-31",
    endsAt: null,
    termMonths: 3,
    tenantPayDay: 31,
    rentalValueCents: 100_000,
  });

  assert.deepEqual(
    parcelas.map((p) => p.dueDate),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
});

test("sem dia de pagamento, vence no dia do início da locação", () => {
  const parcelas = buildRentSchedule({
    startsAt: "2026-03-15",
    endsAt: null,
    termMonths: 2,
    tenantPayDay: null,
    rentalValueCents: 100_000,
  });

  assert.deepEqual(
    parcelas.map((p) => p.dueDate),
    ["2026-03-15", "2026-04-15"],
  );
});

test("sem termMonths, o prazo vem do intervalo início→vencimento", () => {
  const parcelas = buildRentSchedule({
    startsAt: "2026-01-01",
    endsAt: "2026-07-01",
    termMonths: null,
    tenantPayDay: 5,
    rentalValueCents: 100_000,
  });

  assert.equal(parcelas.length, 6);
});

test("contrato sem valor ou sem início não gera parcela", () => {
  const base = { startsAt: "2026-01-01", endsAt: null, termMonths: 12, tenantPayDay: 5 };
  assert.deepEqual(buildRentSchedule({ ...base, rentalValueCents: null }), []);
  assert.deepEqual(buildRentSchedule({ ...base, rentalValueCents: 0 }), []);
  assert.deepEqual(
    buildRentSchedule({ ...base, startsAt: null, rentalValueCents: 100_000 }),
    [],
  );
  assert.deepEqual(
    buildRentSchedule({ ...base, termMonths: 0, rentalValueCents: 100_000 }),
    [],
  );
});
