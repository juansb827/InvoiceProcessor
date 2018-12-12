const router = require("express").Router();
const emailAccount = require("./../services/emailAccount");
const googleAuth = require("googleAuth");
const { getConfParameters } = require('../lib/confParameters');
router.get("/authUrl", (req, res, next) => {
  const { emailAddress, provider } = req.query;

  if (!emailAddress || !provider) {
    const err = new Error(
      'params "emailAddress" and "provider" are missing or invalid'
    );
    err.statusCode = 400;
    return next(err);
  }
  const queryParams = new URLSearchParams({
    emailAddress,
    provider
  });

  //endoint where google servers will send the verication code
  //redirectURL = `${process.env.API_ENDPOINT}${req.baseUrl}/registerAccount?${queryParams.toString()}`
  const client = googleAuth.createoAuth2Client(
    CLIENT_ID,
    CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  const authUrl = googleAuth.generateAuthUrl(client);

  res.status(200).send({
    redirectURL: authUrl
  });
});

router.post("/", async (req, res, next) => {

  try {
    const contextObject = {
      accountData: req.body,
      config: {}
    }

    const confParameters = await getConfParameters(
      'gapi_client_id',
      'gapi_client_secret',
      'pg_encrypt_password'
    );

    contextObject.config.gapi_client_id = confParameters.gapi_client_id;
    contextObject.config.gapi_client_secret = confParameters.gapi_client_secret;
    contextObject.config.encrypt_password = confParameters.pg_encrypt_password;
  
    const newAccount = await emailAccount.testConnectionAndCreate(contextObject);
    res.status(200).send(newAccount);

  } catch (err) {    
    next(err);
  }
});

module.exports = router;
