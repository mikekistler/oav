import { readFileSync } from "fs";
import path from "path";
import Handlebars from "handlebars";
import * as hd from "humanize-duration";
import moment from "moment";
import { ResponseDiffItem, RuntimeError, StepResult, TestScenarioResult } from "./reportGenerator";

const commonHelper = (opts: HelperOpts) => ({
  renderPlain: (s: string) => s,
  renderUri: (s: string) => `${path.join(opts.swaggerRootDir, s)}`,
  renderSymbol: (result: ResultState) => `${resultStateSymbol[result]}`,
  renderScenarioTitle: (ts: TestScenarioMarkdownResult) =>
    `${ts.testScenarioName}: ${ts.fatalStepsCount} Fatals, ${ts.failedStepsCount} Errors`,
  renderStepTitle: (ts: TestScenarioMarkdownStepResult) =>
    `${ts.stepName}: ${ts.fatalStepsCount} Fatals, ${ts.failedStepsCount} Errors`,
  renderDuration: (start: Date, end: Date) =>
    `${hd.default(moment.duration(moment(end).diff(moment(start))).asMilliseconds())}`,
  shouldReportError: (sr: TestScenarioMarkdownStepResult) =>
    sr.failedStepsCount + sr.fatalStepsCount > 0,
  renderFatalErrorCode: (e: RuntimeError) => `${e.severity} ${e.code}`,
  renderFatalErrorDetail: (e: RuntimeError) => `${e.message}`,
  renderDiffErrorCode: (e: ResponseDiffItem) => `${e.severity} ${e.code}`,
  renderDiffErrorDetail: (e: ResponseDiffItem) => `${e.jsonPath} ${e.message}`,
});

type ResultState = keyof typeof ResultStateStrings;

const ResultStateStrings = {
  fatal: `Fatal`,
  failed: `Failed`,
  succeeded: `Succeeded`,
  warning: `Warning`,
};

export const resultStateSymbol: { [key in ResultState]: string } = {
  fatal: "❌",
  failed: "❌",
  succeeded: "️✔️",
  warning: "⚠️",
};

interface TestScenarioMarkdownStepResult {
  stepName: string;
  result: ResultState;
  exampleFilePath?: string;
  correlationId?: string;
  operationId: string;
  fatalStepsCount: number;
  failedStepsCount: number;
  warningStepsCount: number;
  runtimeError?: RuntimeError[];
  responseDiffResult?: ResponseDiffItem[];
}

interface TestScenarioMarkdownResult {
  testScenarioName: string;
  result: ResultState;
  swaggerFilePaths: string[];
  startTime: Date;
  endTime: Date;
  runId: string;
  fatalStepsCount: number;
  failedStepsCount: number;
  warningStepsCount: number;
  steps: TestScenarioMarkdownStepResult[];
}

interface HelperOpts {
  swaggerRootDir: "root";
}

export const compileHandlebarsTemplate = <T>(fileName: string, opts: HelperOpts) => {
  const generationViewTemplate = readFileSync(
    path.join(__dirname, "templates", fileName)
  ).toString();
  const templateDelegate = Handlebars.compile<T>(generationViewTemplate, { noEscape: true });
  const helpers = commonHelper(opts);
  return (data: T) => templateDelegate(data, { helpers });
};

const generateView = compileHandlebarsTemplate<TestScenarioMarkdownResult>(
  "markdownReport.handlebars",
  {
    swaggerRootDir: "root",
  }
);

const stepIsFatal = (sr: StepResult) => sr.runtimeError && sr.runtimeError.length > 0;
const stepIsFailed = (sr: StepResult) => sr.responseDiffResult && sr.responseDiffResult.length > 0;

const asMarkdownStepResult = (sr: StepResult): TestScenarioMarkdownStepResult => {
  let result: ResultState = "succeeded";
  if (stepIsFatal(sr)) {
    result = "fatal";
  } else if (stepIsFailed(sr)) {
    result = "failed";
  }

  const r: TestScenarioMarkdownStepResult = {
    result,
    fatalStepsCount: sr.runtimeError ? sr.runtimeError.length : 0,
    failedStepsCount: sr.responseDiffResult ? sr.responseDiffResult.length : 0,
    warningStepsCount: 0,
    ...sr,
  };
  return r;
};

const asMarkdownResult = (tsr: TestScenarioResult): TestScenarioMarkdownResult => {
  const fatalCount = tsr.stepResult.filter(
    (sr) => sr.runtimeError && sr.runtimeError.length > 0
  ).length;
  const errorCount = tsr.stepResult.filter(
    (sr) => sr.responseDiffResult && sr.responseDiffResult.length > 0
  ).length;
  let resultState: ResultState = "succeeded";
  if (fatalCount > 0) {
    resultState = "fatal";
  } else if (errorCount > 0) {
    resultState = "failed";
  } else {
    resultState = "succeeded";
  }

  const r: TestScenarioMarkdownResult = {
    testScenarioName: tsr.testScenarioName!,
    result: resultState,
    swaggerFilePaths: tsr.swaggerFilePaths,
    startTime: new Date(tsr.startTime!),
    endTime: new Date(tsr.endTime!),
    runId: tsr.runId!,
    fatalStepsCount: fatalCount,
    failedStepsCount: errorCount,
    warningStepsCount: 0,
    steps: tsr.stepResult.map(asMarkdownStepResult),
  };

  return r;
};

export const generateMarkdownReportHeader = (): string => "<h3>Azure API Test Report</h3>";
export const generateMarkdownReport = (testScenarioResult: TestScenarioResult): string => {
  const result = asMarkdownResult(testScenarioResult);
  const body = generateView(result);
  return body;
};
