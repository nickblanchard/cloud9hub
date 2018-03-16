var fs = require('fs'),
  path = require('path'),
  rimraf = require('rimraf'),
  _ = require('lodash'),
  fork = require('child_process').fork,
  request = require('request');

var respondInvalidWorkspace = function(res) {
  res.status(400);
  res.json({msg: "Invalid workspace name"});
};

var createWorkspace = function(params, req, res) {
  var potentiallyBadPathName = params.name.split(path.sep);
  var workspaceName = potentiallyBadPathName[potentiallyBadPathName.length-1];

  if(workspaceName === '..') {
    respondInvalidWorkspace(res);
    return;
  }

  fs.mkdir(__dirname + '/../workspaces/' + workspaceName, '0700', function(err) {
    if(err) {
      respondInvalidWorkspace(res);
      return;
    }

    res.json({msg: "Workspace " + workspaceName + " was created."});
  });
}

var createLocalWorkspace = function(params) {
  var workspaceName = params.name;

  fs.mkdir(__dirname + '/../workspaces/' + workspaceName, '0700', function(err) {});
}

var createWorkspaceKillTimeout = function(req, workspaceProcess, workspaceName) {
  var timeout = setTimeout(function() {
    process.kill(-workspaceProcess.pid, 'SIGTERM');
    req.app.get('runningWorkspaces')[workspaceName] = undefined;
    console.info("Killed workspace " + workspaceName);
   }, 900000); //Workspaces have a lifetime of 15 minutes

   return timeout;
};

/*
 * POST/GET create a new workspace
 */
exports.create = function(req, res) {
  if(req.body.name) {
    createWorkspace(req.body, req, res);
  } else {
    respondInvalidWorkspace(res);
  }
}

/*
 * GET workspaces listing.
 */
exports.list = function(req, res){
    //Use the gitlab api to pull the projects into the list
    
    console.log("Username: " + req.user.username);
    console.log("accesstoken: " + req.user.accessToken);
    
    //INTERNAL REPOSITORIES
    var reqOptions = {
        url: 'https://git.labs.nuance.com/api/v4/groups/2236/projects',
        method: 'GET',
        timeout: 10000,
        headers: {
            'Authorization': 'Bearer ' + req.user.accessToken,
            'Content-Type': 'application/json'
        }
    };
    
    request(reqOptions, function(error, response, body) {
        if(error){
            res.status(500);
            res.json({error:error});
        }
        else{
            var result = JSON.parse(body);
            var workspaces = [];
            for(var i=0; i< result.length; i++) {
                createLocalWorkspace(result[i]);
                workspaces.push({name: result[i].name});
            }
            res.json({workspaces: workspaces});
        }
    });
    
//    fs.readdir(__dirname + '/../workspaces/', function(err, files) {
//        if(err) {
//          res.status(500);
//          res.json({error: err});
//        } else {
//          var workspaces = [];
//          for(var i=0; i< files.length; i++) {
//              // Skip hidden files
//              if(files[i][0] === '.') continue;
//
//              workspaces.push({name: files[i]})
//          }
//          res.json({workspaces: workspaces});
//        }
//    });
};

/**
 * DELETE destroys a workspace
 */
exports.destroy = function(req, res) {
  var potentiallyBadPathName = req.params.name.split(path.sep);
  var workspaceName = potentiallyBadPathName[potentiallyBadPathName.length-1];

  if(workspaceName === '..') {
    respondInvalidWorkspace(res);
    return;
  }

  rimraf(__dirname + "/../workspaces/" + workspaceName, function(err) {
    if(err) {
      res.status("500");
      res.json({msg: "Something went wrong :("});
      return;
    }
    res.json({msg: "Successfully deleted " + workspaceName});
  })
};

/*
 * GET run a workspace
 */
 exports.run = function(req, res) {
  var potentiallyBadPathName = req.params.name.split(path.sep);
  var workspaceName = potentiallyBadPathName[potentiallyBadPathName.length-1];
  
    var isPortTaken = function(port, fn) {
      console.log('checking if port', port, 'is taken');
      var net = require('net')
      var tester = net.createServer()
      .once('error', function (err) {
        if (err.code != 'EADDRINUSE') return fn(err)
        console.log('port', port, 'seems to be taken');
        fn(null, true)
      })
      .once('listening', function() {
        tester.once('close', function() { 
            console.log('port', port, 'seems to be available');
            fn(null, false) 
        })
        .close()
      })
      .listen(port)
    };
    
    var getNextAvailablePort = function(callback){
        var nextFreeWorkspacePort = req.app.get('nextFreeWorkspacePort');
        
        if(nextFreeWorkspacePort > 10000) {
            nextFreeWorkspacePort = 5000;
        }
        
        nextFreeWorkspacePort = nextFreeWorkspacePort + 1;
        console.log('setting nextFreeWorkspacePort to', nextFreeWorkspacePort);
        req.app.set('nextFreeWorkspacePort', nextFreeWorkspacePort);
        
        isPortTaken(nextFreeWorkspacePort, function(err, taken){
            if(taken){
                getNextAvailablePort(callback);
            } else {
                req.app.set('nextFreeWorkspacePort', nextFreeWorkspacePort);
                callback(nextFreeWorkspacePort);
            }
        });
    };

    if(workspaceName === '..') {
      respondInvalidWorkspace(res);
      return;
    }

   if(typeof req.app.get('runningWorkspaces')[workspaceName] === 'undefined'){
       getNextAvailablePort(function(nextFreePort){
            console.log("Starting " + __dirname + '/../c9/server.js for workspace ' + workspaceName + " on port " + nextFreePort);
            var workspaceDir = __dirname + '/../workspaces/' + workspaceName
            var out = fs.openSync(workspaceDir + '/.c9.log', 'a');
            var workspace = fork(__dirname + '/../c9/server.js', ['-w', workspaceDir, '--listen', '0.0.0.0', '-p', nextFreePort, '-a', ':'], {detached: true, stdio: [out, out, out, 'ipc']});
           
            req.app.get('runningWorkspaces')[workspaceName] = {
                killTimeout: createWorkspaceKillTimeout(req, workspace, workspaceName),
                process: workspace,
                name: workspaceName,
                url: req.app.settings.baseUrl + ":" + nextFreePort,
                user: req.user.username
            };
           
            res.json({msg: "Attempted to start workspace", user: req.user.username, url: req.app.settings.baseUrl + ":" + nextFreePort}); 
       });
   } else {
       console.log("Found running workspace", req.app.get('runningWorkspaces')[workspaceName].url);
       res.json({msg: "Found running workspace", user: req.user.username, url: req.app.get('runningWorkspaces')[workspaceName].url});
   }
   
 }

/*
 * POST to keep the workspace alive
*/
 exports.keepAlive = function(req, res) {
   var workspace = req.app.get('runningWorkspaces')[req.params.name];
   clearTimeout(workspace.killTimeout);
   workspace.killTimeout = createWorkspaceKillTimeout(req, workspace.process, workspace.name);
   res.send();
 }
