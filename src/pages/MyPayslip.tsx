import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { PageHead } from "../ui.tsx";
import { PERIOD_LABEL } from "../../lib/config/period.ts";
import { Payslip } from "./Register.tsx";

/** A worker's own payslip for the selected pay period. */
export default function MyPayslip() {
  const { data } = useData();
  const { erp, me, periodId } = useErp();
  const c = data!.result.us.find((x) => x.worker.id === me.workerId);
  const status = erp.payRuns[periodId]?.status ?? "Not started";
  return (
    <>
      <PageHead title="Pay Slip">
        {PERIOD_LABEL[periodId]}. Choose another pay period at the top right.
      </PageHead>
      {!c ? (
        <div className="callout info">You are not paid in this period. Choose another pay period at the top right.</div>
      ) : (
        <>
          {status !== "Completed" && <div className="callout info">Preview: payroll has not completed this period yet (pay run: {status.toLowerCase()}), so amounts can still change.</div>}
          <Payslip c={c} mine />
        </>
      )}
    </>
  );
}
