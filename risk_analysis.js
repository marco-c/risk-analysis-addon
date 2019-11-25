/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

function getRiskAnalysisURL(diffID, artifact) {
  return `https://community-tc.services.mozilla.com/api/index/v1/task/project.relman.bugbug.classify_patch.diff.${diffID}/artifacts/public/${artifact}`;
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

async function getMethodLevelRiskAnalysisResults(diffID) {
  const response = await fetch(getRiskAnalysisURL(diffID, "method_level.json"));
  if (!response.ok) {
    throw new Error("Error fetching method-level risk analysis for this diff.");
  }
  return await response.json();
}

async function injectOverallResults(diffID, diffDetail) {
  const diffDetailBox = diffDetail.parentElement.parentElement.parentElement.parentElement.parentElement;

  const riskAnalysisResultPromise = getRiskAnalysisResult(diffID);
  const riskAnalysisFeaturesPromise = getRiskAnalysisFeatures(diffID);

  const riskAnalysisResult = await riskAnalysisResultPromise;

  const RED = "rgb(255, 13, 87)";
  const BLUE = "rgb(30, 136, 229)";

  const nonRiskyProb = riskAnalysisResult[0];
  const riskyProb = riskAnalysisResult[1];
  const riskyText = riskyProb > nonRiskyProb ? "Risky" : "Not risky"
  const riskyColor = riskyProb > nonRiskyProb ? RED : BLUE;
  const confidence = Math.round(100 * (riskyProb > nonRiskyProb ? riskyProb : nonRiskyProb));

  let riskAnalysisBox = diffDetailBox.cloneNode(true);

  let riskAnalysisTitle = riskAnalysisBox.querySelector("span.phui-header-header");
  riskAnalysisTitle.innerHTML = `Diff Risk Analysis - <span style="color:${riskyColor};">${riskyText}</span> with ${confidence}% confidence`;

  function highlight(index) {
    d3.select(`#feature_${index}_text`)
      .transition()
      .ease(d3.easeCubic)
      .duration('200')
      .style("background-color", chosenFeatures[index] ? RED : BLUE);

    d3.select(`#feature_${index}_bar`)
      .transition()
      .ease(d3.easeCubic)
      .duration('200')
      .style("filter", "url(#glow)");
  }

  function dehighlight(index) {
    d3.select(`#feature_${index}_text`)
      .transition()
      .ease(d3.easeCubic)
      .duration('200')
      .style("background-color", null);

    d3.select(`#feature_${index}_bar`)
      .transition()
      .ease(d3.easeCubic)
      .duration('200')
      .style("filter", null);
  }

  let riskAnalysisContent = riskAnalysisBox.querySelector('div[data-sigil=phui-tab-group-view]');

  let riskAnalysisGraph = document.createElement("div");
  riskAnalysisGraph.id = "riskAnalysisGraph";
  riskAnalysisGraph.width = "100%";
  riskAnalysisGraph.height = 90;

  riskAnalysisContent.firstChild.replaceWith(riskAnalysisGraph);

  let riskAnalysisFeatures = await riskAnalysisFeaturesPromise;
  // TODO: Fix this directly in the json output of the classify-patch task in bugbug.
  riskAnalysisFeatures.forEach(f => f.shap = Number(f.shap));

  let riskAnalysisLegend = document.createElement("div");
  let riskAnalysisLegendUl = document.createElement("ul");
  riskAnalysisLegendUl.style["list-style-type"] = "upper-roman";
  let featureCount = 5;
  let chosenFeatures = {};
  for (let riskAnalysisFeature of riskAnalysisFeatures) {
    let index = riskAnalysisFeature["index"];
    let name = riskAnalysisFeature["name"];
    let shap_value = riskAnalysisFeature["shap"];
    let value = Math.round(riskAnalysisFeature["value"]);

    let monotonicity = riskAnalysisFeature["spearman"][0];
    let median_bug_introducing = riskAnalysisFeature["median_bug_introducing"];
    let median_clean = riskAnalysisFeature["median_clean"];

    let message;
    // If it contributes negatively to the prediction, it is monotonic positive and its value is closer to the median for bug-introducing commits rather than clean.
    if (shap_value > 0 && monotonicity > 0 && Math.abs(value - median_bug_introducing) < Math.abs(value - median_clean)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_buggy_values_higher_than_median"]);
      if (perc < 55) {
        continue;
      }
      message = `<b>${name}</b> is <span style="font-weight:bold;color:${RED}">too large</span> (${value}), as in ${perc}% of patches introducing regressions.`;
    }
    // If it contributes negatively to the prediction, it is monotonic negative and its value is closer to the median for buggy commits rather than clean.
    else if (shap_value > 0 && monotonicity < 0 && Math.abs(value - median_bug_introducing) < Math.abs(value - median_clean)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_buggy_values_lower_than_median"]);
      if (perc < 55) {
        continue;
      }
      message = `<b>${name}</b> is <span style="font-weight:bold;color:${RED}">too small</span> (${value}), as in ${perc}% of patches introducing regressions.`;
    }
    // If it contributes positively to the prediction, it is monotonic positive and its value is closer to the median for clean commits rather than bug-introducing.
    else if (shap_value < 0 && monotonicity > 0 && Math.abs(value - median_clean) < Math.abs(value - median_bug_introducing)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_clean_values_lower_than_median"]);
      if (perc < 55) {
        continue;
      }
      message = `<b>${name}</b> is <span style="font-weight:bold;color:${BLUE}">small</span> (${value}), as in ${perc}% of patches not introducing regressions.`;
    }
    // If it contributes positively to the prediction, it is monotonic negative and its value is closer to the median for clean commits rather than bug-introducing
    else if (shap_value < 0 && monotonicity < 0 && Math.abs(value - median_clean) < Math.abs(value - median_bug_introducing)) {
      let perc = Math.round(100 * riskAnalysisFeature["perc_clean_values_higher_than_median"]);
      if (perc < 55) {
        continue;
      }
      message = `<b>${name}</b> is <span style="font-weight:bold;color:${BLUE}">large</span> (${value}), as in ${perc}% of patches not introducing regressions.`;
    }
    // We can't say much otherwise, e.g. a case like:
    // # of times the components were touched before (max)
    // shap value: +0.14288196611463377
    // monotonicity:  SpearmanrResult(correlation=-0.06891128912176979, pvalue=2.488375295591371e-125)
    // value:  22052.0
    // mean for y == 0 is: 4921.635160123906
    // mean for y == 1 is: 4079.935478215131
    else {
      message = `<b>${name}</b> (${value})`;
    }

    if (message) {
      let riskAnalysisLegendLi = document.createElement("li");
      riskAnalysisLegendLi.style["margin-left"] = "28px";
      riskAnalysisLegendLi.index = index;

      let riskAnalysisLegendText = document.createElement("span");
      riskAnalysisLegendText.id = `feature_${index}_text`;
      riskAnalysisLegendText.innerHTML = message;

      let riskAnalysisFeaturePlot = document.createElement("img");
      riskAnalysisFeaturePlot.id = `feature_${index}_plot`;
      riskAnalysisFeaturePlot.src = `data:image/png;base64,${riskAnalysisFeature["plot"]}`;
      riskAnalysisFeaturePlot.style.maxWidth = "95%";
      riskAnalysisFeaturePlot.style.display = "none";

      let riskAnalysisLegendShowPlotLink = document.createElement("a");
      riskAnalysisLegendShowPlotLink.textContent = "Show feature plot";
      riskAnalysisLegendShowPlotLink.style.fontSize = "x-small";
      riskAnalysisLegendShowPlotLink.onclick = function(event) {
        let plotElem = document.getElementById(`feature_${event.target.parentElement.index}_plot`);
        if (event.target.textContent == "Show feature plot") {
          plotElem.style.display = null;
          event.target.textContent = "Hide feature plot";
        } else {
          plotElem.style.display = "none";
          event.target.textContent = "Show feature plot";
        }
      };

      riskAnalysisLegendLi.appendChild(riskAnalysisLegendText);
      riskAnalysisLegendLi.appendChild(document.createTextNode(" "));
      riskAnalysisLegendLi.appendChild(riskAnalysisLegendShowPlotLink);
      riskAnalysisLegendLi.appendChild(riskAnalysisFeaturePlot);

      riskAnalysisLegendText.onmouseenter = function(event) {
        highlight(event.target.parentElement.index);
      }
      riskAnalysisLegendText.onmouseleave = function(event) {
        dehighlight(event.target.parentElement.index);
      }

      riskAnalysisLegendUl.appendChild(riskAnalysisLegendLi);

      chosenFeatures[index] = shap_value > 0;

      featureCount--;
      if (featureCount == 0) {
        break;
      }
    }
  }

  riskAnalysisFeatures = riskAnalysisFeatures.filter(f => chosenFeatures.hasOwnProperty(f.index));

  riskAnalysisLegend.appendChild(riskAnalysisLegendUl);
  riskAnalysisContent.appendChild(riskAnalysisLegend);

  riskAnalysisContent.appendChild(document.createElement("br"));

  let riskAnalysisOverallFeatures = document.createElement("a");
  riskAnalysisOverallFeatures.textContent = "See the most important features considered by the model";
  riskAnalysisOverallFeatures.href = "https://community-tc.services.mozilla.com/api/index/v1/task/project.relman.bugbug.train_regressor.latest/artifacts/public/feature_importance.png";
  riskAnalysisOverallFeatures.target = "_blank";
  riskAnalysisOverallFeatures.style.fontSize = "x-small";
  riskAnalysisContent.appendChild(riskAnalysisOverallFeatures);

  diffDetailBox.parentNode.insertBefore(riskAnalysisBox, diffDetailBox.nextSibling);

  let svg = d3.select("#riskAnalysisGraph")
    .append("svg")
    .attr("width", riskAnalysisGraph.clientWidth)
    .attr("height", riskAnalysisGraph.height);

  let margin = {
    top: 30,
    right: 20,
    bottom: 30,
    left: 20
  };
  let width = +svg.attr("width") - margin.left - margin.right;
  let height = +svg.attr("height") - margin.top - margin.bottom;

  let x = d3.scaleLinear().range([0, width]);
  let y = d3.scaleBand().range([height, 0]).padding(0.1);

  let z = d3.scaleOrdinal()
    .range([RED, BLUE]);

  let g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  //Container for the gradients
  let defs = svg.append("defs");

  //Filter for the outside glow
  let filter = defs.append("filter")
    .attr("id","glow");
  filter.append("feGaussianBlur")
    .attr("stdDeviation","3.5")
    .attr("result","coloredBlur");
  let feMerge = filter.append("feMerge");
  feMerge.append("feMergeNode")
    .attr("in","coloredBlur");
  feMerge.append("feMergeNode")
    .attr("in","SourceGraphic");

  riskAnalysisFeatures.sort((a, b) => {
    if (a.shap > 0 && b.shap < 0) {
      return -1;
    } else if (a.shap < 0 && b.shap > 0) {
      return 1;
    } else {
      return a.shap - b.shap;
    }
  });

  let start = 0;
  for (let feature of riskAnalysisFeatures) {
    feature.start = start;
    feature.end = Math.abs(feature.shap) + start;
    start = feature.end;
  }

  x.domain([0, d3.max(riskAnalysisFeatures, f => f.end)]);
  z.domain([true, false]);

  g.append("g")
   .attr("transform", `translate(0,${height})`)
   .call(d3.axisBottom(x).tickFormat(""));

  if (riskAnalysisFeatures.some(f => f.shap > 0)) {
    g.append("text")
     .attr("x", d3.max(riskAnalysisFeatures, f => {
      if (f.shap < 0) {
        return Number.NEGATIVE_INFINITY;
      }

      return x(f.end);
    }) - 8)
     .attr("text-anchor", "end")
     .attr("y", -5)
     .attr("fill", RED)
     .attr("font-size", 12)
     .text(() => "increasing risk →");
  }

  if (riskAnalysisFeatures.some(f => f.shap < 0)) {
    g.append("text")
     .attr("x", d3.min(riskAnalysisFeatures, f => {
      if (f.shap > 0) {
        return Number.POSITIVE_INFINITY;
      }

      return x(f.start);
    }) + 5)
     .attr("text-anchor", "start")
     .attr("y", -5)
     .attr("fill", BLUE)
     .attr("font-size", 12)
     .text(() => "← decreasing risk");
  }

  g.selectAll(".bar")
   .data(riskAnalysisFeatures)
   .enter().append("rect")
   .attr("id", f => `feature_${f.index}_bar`)
   .attr("fill", f => z(f.shap > 0))
   .attr("class", "bar")
   .attr("x", f => x(f.start))
   .attr("height", y.bandwidth())
   .attr("width", f => x(f.end) - x(f.start) - 3)
   .on("mouseenter", f => highlight(f.index))
   .on("mouseleave", f => dehighlight(f.index));
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

async function injectMethodLevelResults(diffID) {
  let methods = await getMethodLevelRiskAnalysisResults(diffID);

  methods = methods.filter(method => method["prediction"] == "TRUE");

  let blocks = document.querySelectorAll("div[data-sigil=differential-changeset]");
  for (let block of blocks) {
    let fileName = block.querySelector("h1.differential-file-icon-header").textContent;

    let lines = block.querySelectorAll("table.differential-diff tbody tr td:nth-child(3)");
    for (let line of lines) {
      let lineNumber = parseInt(line.getAttribute("data-n"));
      if (isNaN(lineNumber)) {
        continue;
      }

      for (let i = methods.length - 1; i >= 0; i--) {
        let method = methods[i];
        if (method["file_name"] == fileName && lineNumber >= method["method_start_line"]) {
          methods.splice(i, 1);

          const confidence = Math.round(100 * method["prediction_true"]);

          let inlineComment = createInlineComment(`The function '${method["method_name"]}' is risky (${confidence}% confidence).`);

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

  await injectMethodLevelResults(diffID);
}

(async function() {
  try {
    await inject();
  } catch (ex) {
    console.error(ex);
  }
})();
