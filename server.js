/**
 * Module dependencies.
 */
process.chdir(__dirname);

var express = require('express'),
  bodyParser = require('body-parser'),
  methodOverride = require('method-override'),
  logger = require('morgan'),
  cookieParser = require('cookie-parser'),
  session = require('express-session'),
  errorHandler = require('errorhandler'),
  favicon = require('serve-favicon'),
  routes = require('./routes'),
  workspace = require('./routes/workspace'),
  index = require('./routes/index'),
  fs = require('fs'),
  path = require('path'),
  http = require('http'),
  https = require('https'),
  path = require('path'),
  passport = require('passport'),
  flash = require('connect-flash'),
  helpers = require('view-helpers'),
  consolidate = require('consolidate'),
  GitLabStrategy = require('passport-gitlab').Strategy;
try {
  
  var config = require(__dirname + '/config.js');
}
catch (e) {
  console.error("No config.js found! Copy and edit config.example.js to config.js!");
  process.exit(1);
}

// Load configurations
// Set the node enviornment variable if not set before
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

var app = express();

app.set('showStackError', true);
// cache=memory or swig dies in NODE_ENV=production
app.locals.cache = 'memory';
// Prettify HTML
app.locals.pretty = true;

app.set('nextFreeWorkspacePort', 3000);

app.engine('html', consolidate.swig);

// Start the app by listening on <port>
var port = process.env.PORT || 5000;

// all environments
app.set('port', port);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');
app.set('baseUrl', config.BASE_URL);
app.set('runningWorkspaces', {});

//Auth
passport.use(new GitLabStrategy({
    clientID: config.GITLAB_CLIENT_ID,
    clientSecret: config.GITLAB_CLIENT_SECRET,
    gitlabURL : "https://git.labs.nuance.com",
    callbackURL: app.get('baseUrl') + ':' + app.get('port') + '/auth/gitlab/callback'
  },
  function(accessToken, refreshToken, profile, done) {
    var username = path.basename(profile.username.toLowerCase());
    
    if (!fs.existsSync(__dirname + '/workspaces/')) {
    //TODO: check for permissions
        if (config.PERMITTED_USERS !== false && config.PERMITTED_USERS.indexOf(username)) return done('Sorry, not allowed :(', null);

      //Okay, that is slightly unintuitive: fs.mkdirSync returns "undefined", when successful..
//      if (fs.mkdirSync(__dirname + '/workspaces/' + path.basename(username), '0700') !== undefined) {
//        return done("Cannot create user", null);
//      }
//      else {
            return done(null, username);
//      }
        }
    return done(null, username);
  }
));

//Middlewares
// Favicon cache taken out temporarily
// app.use(favicon(path.join(__dirname, 'public')));
// Only use logger for development environment
if (process.env.NODE_ENV === 'development') {
  app.use(logger('dev'));
}
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());
app.use(methodOverride());
app.use(cookieParser('C10ud9hUb s3cr3t'));
app.use(session({
  resave: false,
  saveUninitialized: false,
  secret: 'C10ud9hUb s3cr3t'
}));
// Initialize Passport!  Also use passport.session() middleware, to support
// persistent login sessions (recommended).
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
// Dynamic helpers
app.use(helpers('Cloud9Hub'));
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(errorHandler());
}

//Auth requests
app.get('/auth/gitlab', passport.authenticate('gitlab'), function(req, res) {});
app.get('/auth/gitlab/callback',
  passport.authenticate('gitlab', {
    failureRedirect: '/'
  }),
  function(req, res) {
    res.redirect('/#/dashboard');
  });

app.get('/logout', function(req, res) {
  req.logout();
  res.json('OK');
});

// Bootstrap routes
var routes_path = __dirname + '/routes';
var walk = function(path) {
  fs.readdirSync(path).forEach(function(file) {
    var newPath = path + '/' + file;
    var stat = fs.statSync(newPath);
    if (stat.isFile()) {
      if (/(.*)\.(js$|coffee$)/.test(file)) {
        require(newPath)(app, passport);
      }
      // We skip the app/routes/middlewares directory as it is meant to be
      // used and shared by routes as further middlewares and is not a
      // route by itself
    }
    else if (stat.isDirectory() && file !== 'middlewares') {
      walk(newPath);
    }
  });
};
walk(routes_path);

var server;

if (config.SSL && config.SSL.key && config.SSL.cert) {
  var sslOpts = {
    key: fs.readFileSync(config.SSL.key),
    cert: fs.readFileSync(config.SSL.cert)
  };

  server = https.createServer(sslOpts, app);
}
else {
  server = http.createServer(app);
  console.log(app.get('baseUrl') + ':' + app.get('port') + '/auth/gitlab/callback');
}

server.listen(app.get('port'), function() {
  console.log('Express server listening on port ' + app.get('port'));
});

//Helpers

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});
