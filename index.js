var express = require("express");
const algoliasearch = require("algoliasearch");
const cors = require("cors");
const bodyParser = require("body-parser");
const striptags = require("striptags");
const axios = require("axios").default;
const rp = require("request-promise-native");
const config = require("./config");

var app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
var port = process.env.PORT || 3001;
const {
  algoliaApiKey,
  algoliaId,
  confluenceIndexName,
  googleIndexName,
  jiraIndexName,
  jiraWebHookurl,
} = config;
const client = algoliasearch(algoliaId, algoliaApiKey);

function confluenceGet(obj) {
  return rp({
    url: obj.host + "/rest/api/content",
    qs: {
      limit: 20,
      orderBy: "history.lastUpdated",
      expand: [
        "history.lastUpdated",
        "ancestors.page",
        "descendants.page",
        "body.view",
        "space",
      ].join(","),
    },
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${obj.username}:${obj.password}`
      ).toString("base64")}`,
    },
    json: true,
  });
}

function parseDocuments(documents, obj) {
  const buildURL = (uri) =>
    uri ? obj.host + uri.replace(/^\/wiki/, "") : false;

  const parseContent = (html) =>
    html
      ? striptags(html)
          .replace(/(\r\n?)+/g, " ")
          .replace(/\s+/g, " ")
      : "";

  return documents.map((doc) => ({
    objectID: doc.id,
    name: doc.title,
    url: buildURL(doc._links.webui),
    space: doc.space.name,
    spaceMeta: {
      id: doc.space.id,
      key: doc.space.key,
      url: buildURL(doc.space._links.webui),
    },
    lastUpdatedAt: doc.history.lastUpdated.when,
    lastUpdatedBy: doc.history.lastUpdated.by.displayName,
    lastUpdatedByPicture: buildURL(
      doc.history.lastUpdated.by.profilePicture.path.replace(
        /(\?[^\?]*)?$/,
        "?s=200"
      )
    ),
    createdAt: doc.history.createdDate,
    createdBy: doc.history.createdBy.displayName,
    createdByPicture: buildURL(
      doc.history.createdBy.profilePicture.path.replace(
        /(\?[^\?]*)?$/,
        "?s=200"
      )
    ),
    path: doc.ancestors.map(({ title }) => title).join(" › "),
    level: doc.ancestors.length,
    ancestors: doc.ancestors.map(({ id, title, _links }) => ({
      id: id,
      name: title,
      url: buildURL(_links.webui),
    })),
    children: doc.descendants
      ? doc.descendants.page.results.map(({ id, title, _links }) => ({
          id: id,
          name: title,
          url: buildURL(_links.webui),
        }))
      : [],
    content: parseContent(doc.body.view.value),
  }));
}

app.post("/", function (req, res) {
  res.send("res");
});
app.post("/confluenceUpdateData", async function (req, res) {
  try {
    const index = client.initIndex(confluenceIndexName);
    if (
      req.body.host == null ||
      req.body.username == null ||
      req.body.password == null
    ) {
      return res.status(401).json({ message: "Unauthorized Error" });
    }
    const obj = {
      host: req.body.host,
      username: req.body.username,
      password: req.body.password,
    };
    const saveObjects = () =>
      confluenceGet(obj)
        .then(({ results, _links }) => {
          index
            .saveObjects(parseDocuments(results, obj))
            .then((res) => {
              if (_links.next) saveObjects(_links.next);
            })
            .catch();
        })
        .catch();
    saveObjects();
    return res.status(200).json("done");
  } catch (error) {
    return res
      .status(error.statusCode || 401)
      .json({ message: "Unauthorized Error" });
  }
});
app.post("/pushGoogleData", async function (req, res) {
  const options = {
    method: "GET",
    url: "https://www.googleapis.com/drive/v3/files",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + req.body.access_token,
    },
  };
  await axios(options)
    .then((responce) => {
      pushData(responce.data.files, req.body.userid);
      return res.status(200).json({ message: "success" });
    })
    .catch((err) => {
      return res
        .status(err.statusCode || 401)
        .json({ message: "Unauthorized Error" });
    });
});

async function pushData(records, userid) {
  const index = client.initIndex(googleIndexName);
  records.map((record) => {
    record.objectID = record.id;
    record.userid = userid;
    if (record.mimeType === "application/vnd.google-apps.document")
      record.image =
        "https://cdn4.iconfinder.com/data/icons/free-colorful-icons/360/google_docs.png";
    else if (record.mimeType === "application/vnd.google-apps.presentation")
      record.image =
        "https://cdn3.iconfinder.com/data/icons/logos-brands-3/24/logo_brand_brands_logos_google_slides-512.png";
    else if (record.mimeType === "application/vnd.google-apps.spreadsheet")
      record.image =
        "https://cdn2.iconfinder.com/data/icons/leto-blue-big-data/64/big_data_data_volume-512.png";
    else if (record.mimeType === "application/pdf")
      record.image =
        "https://cdn4.iconfinder.com/data/icons/document-paper-file/32/pdf-512.png";
    else
      record.image =
        "https://cdn2.iconfinder.com/data/icons/files-solid/64/multiple-file-question-unknown-miscellaneous-512.png";
  });

  for (var i = 0; i < records.length; i++) {
    var r = [];
    r.push(records[i]);
    index
      .saveObjects(r)
      .then(({ objectIDs }) => {
        //return objectIDs;
        console.log(objectIDs);
      })
      .catch((e) => console.log(e));
  }
}
app.post("/confluenceAuth", async function (req, res) {
  if (
    req.body.host == null ||
    req.body.username == null ||
    req.body.password == null
  ) {
    return res.status(401).json({ message: "Unauthorized Error" });
  }
  const obj = {
    host: req.body.host,
    username: req.body.username,
    password: req.body.password,
  };
  await rp({
    url: obj.host + "/rest/api/content",
    qs: {
      limit: 20,
      orderBy: "history.lastUpdated",
      expand: [
        "history.lastUpdated",
        "ancestors.page",
        "descendants.page",
        "body.view",
        "space",
      ].join(","),
    },
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${obj.username}:${obj.password}`
      ).toString("base64")}`,
    },
    json: true,
  })
    .then((responce) => {
      return res.status(200).json({ message: "success" });
    })
    .catch((err) => {
      return res
        .status(err.statusCode || 401)
        .json({ message: "Unauthorized Error" });
    });
});

app.post("/jiraAuth", async function (req, res) {
  const url = req.body.url;
  const username = req.body.username;
  const password = req.body.password;
  const options = {
    method: "GET",
    url: url + "/rest/api/3/project",
    auth: { username: username, password: password },
    headers: { Accept: "application/json" },
  };
  await axios(options)
    .then(function (responce) {
      checkWebhook(url, username, password);
      return res.status(200).json({ greeting: "success" });
    })
    .catch(function (err) {
      return res.status(400).json({ greeting: "error" });
    });
});

const createWebhook = async (url, username, password) => {
  const data = {
    name: "This is default webhook ",
    url: jiraWebHookurl + "/addIsuue",
    events: ["jira:issue_created", "jira:issue_updated"],
    jqlFilter: "Project = JRA AND resolution = Fixed",
    excludeIssueDetails: false,
  };

  const options = {
    method: "post",
    url: url + "/rest/webhooks/1.0/webhook",
    auth: { username: username, password: password },

    headers: { Accept: "application/json" },
    data: data,
  };
  await axios(options)
    .then(function (responce) {
      console.log("success");
    })
    .catch(function (err) {
      console.log("error");
    });
};

const checkWebhook = async (url, username, password) => {
  const options = {
    method: "get",
    url: url + "/rest/webhooks/1.0/webhook",
    auth: { username: username, password: password },
    headers: { Accept: "application/json" },
  };
  await axios(options)
    .then(function (responce) {
      const webhooks = responce.data;
      let flag = false;
      webhooks.map((hook) => {
        if (hook.url === jiraWebHookurl + "/addIsuue") {
          console.log(hook.url);
          flag = true;
        }
      });
      if (flag) console.log("web hook created already..");
      else {
        console.log("need to create");
        createWebhook(url, username, password);
      }
    })
    .catch(function (err) {
      console.log("error");
    });
};

app.post("/addIsuue", (req, res) => {
  const projects = req.body;
  const record = {};
  record.IssueId = projects.issue.id;
  record.ProjectName = projects.issue.fields.project.name;
  record.Issue = projects.issue;
  record.Summary = projects.issue.fields.summary;
  record.Description = projects.issue.fields.description;
  record.Project = projects.issue.fields.project;
  record.objectID = projects.issue.id;
  const records = [record];
  const index = client.initIndex(jiraIndexName);
  console.log("index:>", index);
  index.saveObjects(records);
});

app.listen(port, function () {
  console.log(`Example app listening on port ! ${port}`);
});
