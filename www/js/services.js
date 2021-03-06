var sidewinderServerHost = "http://sidewinder-server.sidewinder.1558821d.svc.dockerapp.io:5103";

angular.module('sidewinder.services', ['ngLodash'])
    .service('SidewinderServer', function($q, $http, GitHubRepo, lodash) {
        var server = this;
        server.registerDevice = function(deviceToken) {
          console.debug('registering device ' + deviceToken);
            var url = sidewinderServerHost + "/devices";
            return $q(function(resolve, reject) {
                $http.post(url, {
                    deviceId: deviceToken
                }).then(function() {
                    resolve(deviceToken);
                }).catch(function() {
                    reject("Failed to register device.");
                })
            });
        };
        server.unregisterDevice = function(deviceToken) {
            var url = sidewinderServerHost + "/devices/" + deviceToken;
            return $q(function(resolve, reject) {
                $http.delete(url).then(function() {
                    resolve(deviceToken);
                }).catch(function() {
                    reject("Failed to unregister device.");
                })
            });
        };
        server.addRepository = function(deviceToken, repo) {
            var url = sidewinderServerHost + "/devices/" + deviceToken + "/repositories";
            return $q(function(resolve, reject) {
                $http.post(url, {
                    name: repo.fullName
                }).then(function() {
                    resolve(repo);
                }).catch(function() {
                    reject("Failed to add repo to server.");
                })
            });
        };

        server.listRepositories = function(deviceToken) {
            return $q(function(resolve, reject) {
                var url = sidewinderServerHost + "/devices/" + deviceToken + "/repositories";
                $http.get(url)
                    .then(function(response) {
                        resolve(lodash.map(response.data, function(repositoryEntry) {
                            var elements = repositoryEntry.Name.split('/');
                            return new GitHubRepo(elements[0], elements[1]);
                        }));
                    }).catch(function(err) {
                        reject("Failed to retrieve repos from server.");
                    })
            })
        }
    })
    .factory('RepositoryRepository', function($q, SidewinderServer, PushService){
      var Repository = {};
      function getDeviceToken() {
        return PushService.init().then(function(push) {
          return push.deviceToken;
        });
      }
      Repository.all = function() {
        return getDeviceToken().then(function(deviceToken) {
          return SidewinderServer.listRepositories(deviceToken);
        });
      };
      Repository.add = function(repo) {
        return getDeviceToken().then(function(deviceToken) {
          return SidewinderServer.addRepository(deviceToken, repo);
        })
      };
      return Repository;
    })
    .factory('loggingHttpInterceptor', function($q, $log){
        var interceptor = {
          request: function(config){
            $log.info('HTTP request:\n' + JSON.stringify(config));
            return $q(function(resolve, reject){
              resolve(config);
            });
          },
          response: function(response){
            return $q(function(resolve, reject){
              $log.debug('HTTP response:\n' + JSON.stringify(response));
              resolve(response);
            });
          }
        };
        return interceptor;
    })
    .factory('RepoAssessor', function($http, $q) {
        return {
            assess: function(repository) {
                var url = "https://api.github.com/repos/" + repository.fullName + "/commits/master/status";
                return $q(function(resolve) {
                    $http.get(url).success(function(data) {
                        var state = data.state;
                        if (state === 'pending' && data.statuses.length < 1) {
                            state = 'unknown';
                        }
                        var statuses = (data.statuses || []).map(function(status) {
                            return {
                                state: status.state,
                                message: status.description,
                                href: status.target_url,
                                context: status.context,
                                timestamp: status.updated_at
                            };
                        });
                        resolve({
                            state: state,
                            statuses: statuses
                        });
                    }).error(function() {
                        resolve({
                            state: 'unknown'
                        });
                    });
                });
            }
        };
    })
    .factory('GitHubRepo', function() {
        return function(owner, name) {
            var repo = this;
            repo.owner = owner;
            repo.name = name;
            repo.status = {
                state: 'unknown'
            };
            Object.defineProperty(repo, 'fullName', {
                get: function() {
                    return repo.owner + '/' + repo.name;
                }
            });
            Object.defineProperty(repo, 'displayURL', {
                get: function() {
                    return ('https://github.com/' +
                        (repo.owner || '{owner}') +
                        '/' +
                        (repo.name || '{repo-name}'));
                }
            });
            repo.toObject = function() {
                return {
                    owner: repo.owner,
                    name: repo.name
                };
            }
        };
    })
    .factory('PushService', function($q, $ionicPlatform, $window, $log, debugMode) {
        var deviceToken = undefined;
        if (debugMode.active && !ionic.Platform.isIOS()) {

          deviceToken = debugMode.deviceToken;
        }
        var doNothing = angular.noop;
        function init() {
            return $q(function(resolve, reject) {
                if (debugMode.active && debugMode.deviceToken){
                  $log.debug('using DEBUG device token: '+ debugMode.deviceToken);
                  resolve({
                    addHandler: doNothing,
                    deviceToken: debugMode.deviceToken,
                    unregister: doNothing,
                    enabled: true
                  });
                  return;
                }
                $ionicPlatform.ready(function() {
                    if (!window.PushNotification) {
                        reject('Push notifications not available.');
                        return;
                    }
                    var push = $window.PushNotification.init({
                        ios: {
                            badge: true,
                            sound: true,
                            alert: true
                        }
                    });
                    var unregister = $q(function(reject, resolve) {
                        push.unregister(function() {
                            resolve();
                        }, function(error) {
                            reject(error);
                        });
                    });
                    var addHandler = function(callback) {
                        push.on('notification', callback);
                    };
                    push.on('error', function(err) {
                        $log.error("push error: " + err);
                    });

                    var doResolve = function() {
                      doResolve = doNothing;
                      resolve({
                          addHandler: addHandler,
                          deviceToken: deviceToken,
                          unregister: unregister,
                          enabled: !!deviceToken
                      });
                    }
                    push.on('registration', function(data) {
                        deviceToken = data.registrationId;
                        doResolve();
                    });
                    setTimeout(function(){ doResolve() }, 1500);
                });
            });
        }

        return {
            init: init
        };
    });
