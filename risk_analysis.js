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

  const riskAnalysisResult = await getRiskAnalysisResult(diffID);
  const riskAnalysisFeaturesPromise = getRiskAnalysisFeatures(diffID);

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
  for (let [index, name, value] of riskAnalysisFeatures) {
    let riskAnalysisLegendLi = document.createElement("li");
    riskAnalysisLegendLi.textContent = `${index}. ${name}`;
    value = Number(value);
    riskAnalysisLegendLi.style.color = value > 0 ? "rgb(255, 13, 87)" : "rgb(30, 136, 229)";
    riskAnalysisLegendUl.appendChild(riskAnalysisLegendLi);
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

function injectMethodLevelResults() {
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

function inject() {
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

  injectOverallResults(diffID, diffDetail);

  injectMethodLevelResults();
}

inject();
