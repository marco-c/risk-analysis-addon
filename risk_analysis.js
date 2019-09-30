/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

function getRiskAnalysisURL(diffID, artifact) {
  return `https://index.taskcluster.net/v1/task/project.relman.bugbug.classify_patch.diff.${diffID}/artifacts/public/${artifact}`;
}

async function getRiskAnalysisResult(diffID) {
  const response = await fetch(getRiskAnalysisURL(diffID, "probs.json"));
  if (!response.ok) {
    throw new Error("Error fetching risk analysis results for this diff.");
  }
  return await response.json();
}

async function getRiskAnalysisFeatures(diffID) {
  const response = await fetch(getRiskAnalysisURL(diffID, "importances.json"));
  if (!response.ok) {
    throw new Error("Error fetching risk analysis features for this diff.");
  }
  return await response.json();
}

async function injectOverallResults(diffID, diffDetail) {
  const diffDetailBox = diffDetail.parentElement.parentElement.parentElement.parentElement.parentElement;

  const riskAnalysisResultPromise = getRiskAnalysisResult(diffID);
  const riskAnalysisFeaturesPromise = getRiskAnalysisFeatures(diffID);

  const riskAnalysisResult = await riskAnalysisResultPromise;

  const nonRiskyProb = riskAnalysisResult[0];
  const riskyProb = riskAnalysisResult[1];
  const riskyText = riskyProb > nonRiskyProb ? "Risky" : "Not risky"
  const confidence = Math.round(100 * (riskyProb > nonRiskyProb ? riskyProb : nonRiskyProb));

  let riskAnalysisBox = diffDetailBox.cloneNode(true);

  let riskAnalysisTitle = riskAnalysisBox.querySelector("span.phui-header-header");
  riskAnalysisTitle.textContent = `Diff Risk Analysis - ${riskyText} with ${confidence}% confidence`;

  let riskAnalysisContent = riskAnalysisBox.querySelector('div[data-sigil=phui-tab-group-view]');

  let riskAnalysisFrame = document.createElement("iframe");
  riskAnalysisFrame.src = getRiskAnalysisURL(diffID, "importance.html");
  riskAnalysisFrame.width = "100%";

  riskAnalysisContent.firstChild.replaceWith(riskAnalysisFrame);

  const riskAnalysisFeatures = await riskAnalysisFeaturesPromise;

  let riskAnalysisLegend = document.createElement("div");
  let riskAnalysisLegendUl = document.createElement("ul");
  let featureCount = 3;
  for (let riskAnalysisFeature of riskAnalysisFeatures) {
    let index = riskAnalysisFeature["index"];
    let name = riskAnalysisFeature["name"];
    let shap_value = Number(riskAnalysisFeature["shap"]);
    let value = riskAnalysisFeature["value"];

    let monotonicity = riskAnalysisFeature["spearman"][0];
    let median_bug_introducing = riskAnalysisFeature["median_bug_introducing"];
    let median_clean = riskAnalysisFeature["median_clean"];

    let message;
    // If it contributes negatively to the prediction, it is monotonic positive and its value is closer to the median for bug-introducing commits rather than clean.
    if (shap_value > 0 && monotonicity > 0 && Math.abs(value - median_bug_introducing) < Math.abs(value - median_clean)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_buggy_values_higher_than_median"]);
      message = `${index}. ${name} is too high (${value}). ${perc}% of patches which introduced regressions had a high ${name}.`;
    }
    // If it contributes negatively to the prediction, it is monotonic negative and its value is closer to the median for buggy commits rather than clean.
    else if (shap_value > 0 && monotonicity < 0 && Math.abs(value - median_bug_introducing) < Math.abs(value - median_clean)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_buggy_values_lower_than_median"]);
      message = `${index}. ${name} is too low (${value}). ${perc}% of patches which introduced regressions had a low ${name}.`;
    }
    // XXX: For now, we only want to show features which are increasing the risk, not features which are driving it down.
    // If it contributes positively to the prediction, it is monotonic positive and its value is closer to the median for clean commits rather than bug-introducing.
    /* else if (shap_value < 0 && monotonicity > 0 && Math.abs(value - median_clean) < Math.abs(value - median_bug_introducing)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_clean_values_lower_than_median"]);
      message = `${index}. ${name} is low (${value}). ${perc}% of patches which did not introduce regressions had a low ${name}.`;
    }
    // If it contributes positively to the prediction, it is monotonic negative and its value is closer to the median for clean commits rather than bug-introducing
    else if (shap_value < 0 && monotonicity < 0 && Math.abs(value - median_clean) < Math.abs(value - median_bug_introducing)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_buggy_values_higher_than_median"]);
      console.log(riskAnalysisFeature);
      message = `${index}. ${name} is high (${value}). ${perc}% of patches which did not introduce regressions had a high ${name}.`;
    } */
    // We can't say much otherwise, e.g. a case like:
    // # of times the components were touched before (max)
    // shap value: +0.14288196611463377
    // monotonicity:  SpearmanrResult(correlation=-0.06891128912176979, pvalue=2.488375295591371e-125)
    // value:  22052.0
    // mean for y == 0 is: 4921.635160123906
    // mean for y == 1 is: 4079.935478215131

    if (message) {
      let riskAnalysisLegendLi = document.createElement("li");
      riskAnalysisLegendLi.textContent = message;
      riskAnalysisLegendLi.style.color = shap_value > 0 ? "rgb(255, 13, 87)" : "rgb(30, 136, 229)";
      riskAnalysisLegendUl.appendChild(riskAnalysisLegendLi);

      featureCount--;
      if (featureCount == 0) {
        break;
      }
    }
  }
  riskAnalysisLegend.appendChild(riskAnalysisLegendUl);
  riskAnalysisContent.appendChild(riskAnalysisLegend);

  riskAnalysisContent.appendChild(document.createElement("br"));

  let riskAnalysisOverallFeatures = document.createElement("a");
  riskAnalysisOverallFeatures.textContent = "See the most important features considered by the model";
  riskAnalysisOverallFeatures.href = "https://index.taskcluster.net/v1/task/project.relman.bugbug.train_regressor.latest/artifacts/public/feature_importance.png";
  riskAnalysisOverallFeatures.target = "_blank";
  riskAnalysisOverallFeatures.style.fontSize = "x-small";
  riskAnalysisContent.appendChild(riskAnalysisOverallFeatures);

  diffDetailBox.parentNode.insertBefore(riskAnalysisBox, diffDetailBox.nextSibling);
}

function createInlineComment(inlineCommentText) {
  let inlineRow = document.createElement("tr");
  inlineRow.classList.add("inline");
  inlineRow.setAttribute("data-sigil", "inline-row");

  let firstEmptyTd = document.createElement("td");
  firstEmptyTd.classList.add("n");
  let leftEmptyTd = document.createElement("td");
  leftEmptyTd.classList.add("left");
  let secondEmptyTd = document.createElement("td");
  secondEmptyTd.classList.add("n");
  let copyEmptyTd = document.createElement("td");
  copyEmptyTd.classList.add("copy");

  let contentTd = document.createElement("td");
  contentTd.setAttribute("colspan", "2");

  let inlineCommentDiv = document.createElement("div");
  inlineCommentDiv.classList.add("differential-inline-comment");
  inlineCommentDiv.setAttribute("data-sigil", "differential-inline-comment");

  let inlineCommentDivHead = document.createElement("div");
  inlineCommentDivHead.classList.add("differential-inline-comment-head", "grouped");
  inlineCommentDivHead.setAttribute("data-sigil", "differential-inline-header");

  let inlineCommentDivHeadLeft = document.createElement("div");
  inlineCommentDivHeadLeft.classList.add("inline-head-left");
  inlineCommentDivHeadLeft.textContent = "Risk Analysis Bot";

  inlineCommentDivHead.appendChild(inlineCommentDivHeadLeft);

  inlineCommentDiv.appendChild(inlineCommentDivHead);

  let inlineCommentDivContent = document.createElement("div");
  inlineCommentDivContent.classList.add("differential-inline-comment-content");

  let inlineCommentDivContentContent = document.createElement("div");
  inlineCommentDivContentContent.classList.add("phabricator-remarkup");

  let inlineCommentDivContentContentP = document.createElement("p");
  inlineCommentDivContentContentP.textContent = inlineCommentText;

  inlineCommentDivContentContent.appendChild(inlineCommentDivContentContentP);

  inlineCommentDivContent.appendChild(inlineCommentDivContentContent);

  inlineCommentDiv.appendChild(inlineCommentDivContent);

  contentTd.appendChild(inlineCommentDiv);

  inlineRow.appendChild(firstEmptyTd);
  inlineRow.appendChild(leftEmptyTd);
  inlineRow.appendChild(secondEmptyTd);
  inlineRow.appendChild(copyEmptyTd);
  inlineRow.appendChild(contentTd);

  return inlineRow;
}

async function injectMethodLevelResults() {
  /*let methods = [{
      "name": "nsPresContext::PreferenceChanged",
      "line": 436,
  },
  {
      "name": "nsPresContext::Destroy",
      "line": 252,
  }];*/
  let methods = [];

  let blocks = document.querySelectorAll("div[data-sigil=differential-changeset]");
  for (let block of blocks) {
    let lines = block.querySelectorAll("table.differential-diff tbody tr td:nth-child(3)");
    for (let line of lines) {
      let lineNumber = parseInt(line.getAttribute("data-n"));
      if (isNaN(lineNumber)) {
        continue;
      }

      for (let i = methods.length - 1; i >= 0; i--) {
        let method = methods[i];
        if (lineNumber >= method["line"]) {
          methods.splice(i, 1);

          let inlineComment = createInlineComment(`The function '${method["name"]}' is risky.`);

          line.parentNode.parentNode.insertBefore(inlineComment, line.parentNode.nextSibling);
        }
      }

      if (methods.length == 0) {
        break;
      }
    }

    if (methods.length == 0) {
      break;
    }
  }
}

const diffIDPattern = RegExp(/Diff (\d+)/);

async function inject() {
  let diffID = null;
  let diffDetail = null;

  const headers = document.querySelectorAll("span.phui-header-header");
  for (const header of headers) {
    if (header.textContent == "Diff Detail") {
      diffDetail = header;
      continue;
    }

    const result = header.textContent.match(diffIDPattern);
    if (!result) {
      continue;
    }

    diffID = result[1];
  }

  if (!diffID) {
    throw new Error("Missing diff ID");
  }

  if (!diffDetail) {
    throw new Error("Missing diff detail box");
  }

  await injectOverallResults(diffID, diffDetail);

  await injectMethodLevelResults();
}

(async function() {
  try {
    await inject();
  } catch (ex) {
    console.error(ex);
  }
})();
