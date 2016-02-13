/**
 * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                //Lop off the last part of baseParts, so that . matches the
                //"directory" and not name of the baseName's module. For instance,
                //baseName of "one/two/three", maps to "one/two/three.js", but we
                //want the directory, "one/two" for this normalization.
                name = baseParts.slice(0, baseParts.length - 1).concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("almond", function(){});

/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */



/**
 * Misc IO functions
 * @module IO
 */
define('io',[],function() {
  var log = function() { };
  //var log = console.log.bind(console);

  /**
   * @typedef {Object} SendJson~Options
   * @memberOf module:IO
   * @property {number?} timeout. Timeout in ms to abort.
   *        Default = no-timeout
   */

  /**
   * sends a JSON 'POST' request, returns JSON repsonse
   * @memberOf module:IO
   * @param {string} url url to POST to.
   * @param {Object=} jsonObject JavaScript object on which to
   *        call JSON.stringify.
   * @param {!function(error, object)} callback Function to call
   *        on success or failure. If successful error will be
   *        null, object will be json result from request.
   * @param {module:IO~SendJson~Options?} options
   */
  var sendJSON = function(url, jsonObject, callback, option) {
    option = option || { };
//    var error = 'sendJSON failed to load url "' + url + '"';
    var request = new XMLHttpRequest();
    if (request.overrideMimeType) {
      request.overrideMimeType('text/plain');
    }
    var timeout = option.timeout || 0;
    if (timeout) {
      request.timeout = timeout;
      log("set timeout to: " + request.timeout);
    }
    request.open('POST', url, true);
    var js = JSON.stringify(jsonObject);
    var callCallback = function(error, json) {
      if (callback) {
        log("calling-callback:" + (error ? " has error" : "success"));
        callback(error, json);
        callback = undefined;  // only call it once.
      }
    };
//    var handleAbort = function(e) {
//      log("--abort--");
//      callCallback("error (abort) sending json to " + url);
//    }
    var handleError = function(/*e*/) {
      log("--error--");
      callCallback("error sending json to " + url);
    };
    var handleTimeout = function(/*e*/) {
      log("--timeout--");
      callCallback("timeout sending json to " + url);
    };
    var handleForcedTimeout = function(/*e*/) {
      if (callback) {
        log("--forced timeout--");
        request.abort();
        callCallback("forced timeout sending json to " + url);
      }
    };
    var handleFinish = function() {
      log("--finish--");
      var json = undefined;
      // HTTP reports success with a 200 status. The file protocol reports
      // success with zero. HTTP does not use zero as a status code (they
      // start at 100).
      // https://developer.mozilla.org/En/Using_XMLHttpRequest
      var success = request.status === 200 || request.status === 0;
      if (success) {
        try {
          json = JSON.parse(request.responseText);
        } catch (e) {
          success = false;
        }
      }
      callCallback(success ? null : 'could not load: ' + url, json);
    };
    try {
      // Safari 7 seems to ignore the timeout.
      if (timeout) {
        setTimeout(handleForcedTimeout, timeout + 50);
      }
      request.addEventListener('load', handleFinish, false);
      request.addEventListener('timeout', handleTimeout, false);
      request.addEventListener('error', handleError, false);
      request.setRequestHeader("Content-type", "application/json");
      request.send(js);
      log("--sent: " + url);
    } catch (e) {
      log("--exception--");
      setTimeout(function() {
        callCallback('could not load: ' + url, null);
      }, 0);
    }
  };

  return {
    sendJSON: sendJSON,
  };
});


/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/*eslint strict:0*/

(function(global) {
define('misc/cookies',[],function() {

  // If it node.js no cookies.
  if (global.document === undefined || global.document.cookie === undefined) {
    var noop = function() {};
    return function() {
      return {
        set: noop,
        get: noop,
        erase: noop,
      };
    };
  }

  /**
   * Represents a cookie.
   *
   * This is an object, that way you set the name just once so
   * calling set or get you don't have to worry about getting the
   * name wrong.
   *
   * @example
   *     var fooCookie = new Cookie("foo");
   *     var value = fooCookie.get();
   *     fooCookie.set(newValue);
   *     fooCookie.erase();
   *
   * @constructor
   * @alias Cookie
   * @param {string} name of cookie
   * @param {string?} opt_path path for cookie. Default "/"
   */
  var Cookie = function(name, opt_path) {
    var path = opt_path || "/";

    /**
     * Sets the cookie
     * @param {string} value value for cookie
     * @param {number?} opt_days number of days until cookie
     *        expires. Default = none
     */
    this.set = function(value, opt_days) {
      if (value === undefined) {
        this.erase();
        return;
      }
      // Cordova/Phonegap doesn't support cookies so use localStorage?
      if (window.hftSettings && window.hftSettings.inApp) {
        window.localStorage.setItem(name, value);
        return;
      }
      var expires = "";
      opt_days = opt_days || 9999;
      var date = new Date();
      date.setTime(Date.now() + Math.floor(opt_days * 24 * 60 * 60 * 1000));  // > 32bits. Don't use | 0
      expires = "; expires=" + date.toGMTString();
      var cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + expires + "; path=" + path;
      document.cookie = cookie;
    };

    /**
     * Gets the value of the cookie
     * @return {string?} value of cookie
     */
    this.get = function() {
      // Cordova/Phonegap doesn't support cookies so use localStorage?
      if (window.hftSettings && window.hftSettings.inApp) {
        return window.localStorage.getItem(name);
      }

      var nameEQ = encodeURIComponent(name) + "=";
      var ca = document.cookie.split(';');
      for (var i = 0; i < ca.length; ++i) {
        var c = ca[i];
        while (c.charAt(0) === ' ') {
          c = c.substring(1, c.length);
        }
        if (c.indexOf(nameEQ) === 0) {
          return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
      }
    };

    /**
     * Erases the cookie.
     */
    this.erase = function() {
      if (window.hftSettings && window.hftSettings.inApp) {
        return window.localStorage.removeItem(name);
      }
      document.cookie = this.set(" ", -1);
    };
  };

  return Cookie;
});

}(this));



/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */



define('misc/dialog',[], function() {
  var zIndex = 15000;

  function create(name, options) {
    var elem = document.createElement(name);
    if (options.className) {
      elem.className = options.className;
    }
    var style = options.style;
    if (style) {
      Object.keys(style).forEach(function(key) {
        elem.style[key] = style[key];
      });
    }
    if (options.parent) {
      options.parent.appendChild(elem);
    }
    return elem;
  }

  function addElem(content, options) {
    var elem = create("div", options);
    if (content instanceof HTMLElement) {
      elem.appendChild(content);
    } else {
      elem.innerHTML = content;
    }
    return elem;
  }

  function close(elem) {
    elem.parentNode.removeChild(elem);
    --zIndex;
  }

  /**
   * @typedef {Object} Dialog~Choice
   * @property {string} msg message to display
   * @property {function} [callback] callback if this choice is picked.
   */

  /**
   * @typedef {Object} Dialog~Options
   * @property {string} [title] unused?
   * @property {(string|HTMLElement)} [msg]
   * @property {Dialog~Choice[]} [choices]
   */

  /**
   * Puts up a fullscreen dialog
   * @param {Dialog~Options} options options for dialog.
   * @param {function(?)) [callback] callback when dialog closes
   */
  function modal(options, callback) {
    if (!callback) {
      callback = function() {};
    }

    var cover     = create("div", { className: "hft-dialog-cover", style: { zIndex: zIndex++ } });
    var filler    = create("div", { className: "hft-fullcenter", parent: cover });
    var container = create("div", { className: "hft-dialog-container", parent: filler });

    var closeIt = function() {
      close(cover);
      callback();
    };

    if (options.title) {
      addElem(options.title, { className: "hft-dialog-title", parent: container });
    }

    addElem(options.msg, { className: "hft-dialog-content", parent: container });

    function addObjectChoice(choice, ndx) {
      var div = addElem("div", { className: "hft-dialog-choice", parent: container });
      div.innerHTML = choice.msg;
      var choiceCallback = function() {
        close(cover);
        (choice.callback || callback)(ndx);
      };
      div.addEventListener('click', choiceCallback);
      div.addEventListener('touchend', choiceCallback);
      return div;
    }

    function addStringChoice(msg, ndx) {
      addObjectChoice({
        msg: msg,
        callback: function() {
          callback(ndx);
        },
      });
    }

    if (options.choices) {
      options.choices.forEach(function(choice, ndx) {
       if (typeof choice === 'string') {
         addStringChoice(choice, ndx);
       } else {
         addObjectChoice(choice, ndx);
       }
      });
    } else if (callback) {
      container.addEventListener('click', closeIt, false);
      container.addEventListener('touchend', closeIt, false);
    }

    document.body.appendChild(cover);
  }

  return {
    modal: modal,
  };
});


/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


define('misc/fullscreen',[], function() {

  var requestFullScreen = function(element) {
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    } else if (element.webkitRequestFullScreen) {
      element.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen();
    } else if (element.mozRequestFullscreen) {
      element.mozRequestFullscreen();
    }
  };

  var noop = function() {
  };

  var cancelFullScreen = (
      document.exitFullscreen ||
      document.exitFullScreen ||
      document.msExitFullscreen ||
      document.msExitFullScreen ||
      document.webkitCancelFullscreen ||
      document.webkitCancelFullScreen ||
      document.mozCancelFullScreen ||
      document.mozCancelFullscreen ||
      noop).bind(document);

  function isFullScreen() {
    var f = document.fullscreenElement ||
            document.fullScreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.webkitIsFullScreen;
    return (f !== undefined && f !== null && f !== false);
  }

  var onFullScreenChange = function(element, callback) {
    document.addEventListener('fullscreenchange', function(/*event*/) {
        callback(isFullScreen());
      });
    element.addEventListener('webkitfullscreenchange', function(/*event*/) {
        callback(isFullScreen());
      });
    document.addEventListener('mozfullscreenchange', function(/*event*/) {
        callback(isFullScreen());
      });
  };

  function canGoFullScreen() {
    var body = window.document.body || {};
    var r = body.requestFullscreen ||
            body.requestFullScreen ||
            body.msRequestFullscreen ||
            body.msRequestFullScreen ||
            body.webkitRequestFullScreen ||
            body.webkitRequestFullscreen ||
            body.mozRequestFullScreen ||
            body.mozRequestFullscreen;
    return r !== undefined && r !== null;
  }

  return {
    cancelFullScreen: cancelFullScreen,
    isFullScreen: isFullScreen,
    canGoFullScreen: canGoFullScreen,
    onFullScreenChange: onFullScreenChange,
    requestFullScreen: requestFullScreen,
  };
});

/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */



define('misc/logger',[],function() {
  var NullLogger = function() {
  };

  NullLogger.prototype.log = function() {
  };

  NullLogger.prototype.error = function() {
  };

  var ConsoleLogger = function() {
  };

  ConsoleLogger.prototype.log = function() {
    console.log.apply(console, arguments);
  };

  ConsoleLogger.prototype.error = function() {
    console.error.apply(console, arguments);
  };

  var HTMLLogger = function(element, opt_maxLines) {
    this.container = element;
    this.maxLines = opt_maxLines || 10;
    this.lines = [];
  };

  HTMLLogger.prototype.addLine_ = function(msg, color) {
    var line;
    var text;
    if (this.lines.length < this.maxLines) {
      line = document.createElement("div");
      text = document.createTextNode("");
      line.appendChild(text);
    } else {
      line = this.lines.shift();
      line.parentNode.removeChild(line);
      text = line.firstChild;
    }

    this.lines.push(line);
    text.nodeValue = msg;
    line.style.color = color;
    this.container.appendChild(line);
  };

  // FIX! or move to strings.js
  var argsToString = function(args) {
    var lastArgWasNumber = false;
    var numArgs = args.length;
    var strs = [];
    for (var ii = 0; ii < numArgs; ++ii) {
      var arg = args[ii];
      if (arg === undefined) {
        strs.push('undefined');
      } else if (typeof arg === 'number') {
        if (lastArgWasNumber) {
          strs.push(", ");
        }
        if (arg === Math.floor(arg)) {
          strs.push(arg.toFixed(0));
        } else {
        strs.push(arg.toFixed(3));
        }
        lastArgWasNumber = true;
      } else if (window.Float32Array && arg instanceof Float32Array) {
        // TODO(gman): Make this handle other types of arrays.
        strs.push(tdl.string.argsToString(arg));
      } else {
        strs.push(arg.toString());
        lastArgWasNumber = false;
      }
    }
    return strs.join("");
  };

  HTMLLogger.prototype.log = function() {
    this.addLine_(argsToString(arguments), undefined);
  };

  HTMLLogger.prototype.error = function() {
    this.addLine_(argsToString(arguments), "red");
  };

  var GameLogger = function(client) {
    this.log = client.logImpl.bind(client);
    this.error = client.errorImpl.bind(client);
  };

  return {
    ConsoleLogger: ConsoleLogger,
    GameLogger: GameLogger,
    HTMLLogger: HTMLLogger,
    NullLogger: NullLogger,
  };
});



/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


/**
 * @module Misc
 */
define('misc/misc',[],function() {
  /**
   * Copies properties from obj to dst recursively.
   * @param {Object} obj Object with new settings.
   * @param {Object} dst Object to receive new settings.
   * @param {number?} opt_overwriteBehavior
   *     *   0/falsy = overwrite
   *
   *         src    = {foo:'bar'}
   *         dst    = {foo:'abc'}
   *         result = {foo:'bar'}
   *
   *     *   1 = don't overwrite but descend if deeper
   *
   *         src    = {foo:{bar:'moo','abc':def}}
   *         dst    = {foo:{bar:'ghi'}}
   *         result = {foo:{bar:'ghi','abc':def}}
   *
   *         'foo' exists but we still go deeper and apply 'abc'
   *
   *     *   2 = don't overwrite don't descend
   *
   *             src    = {foo:{bar:'moo','abc':def}}
   *             dst    = {foo:{bar:'ghi'}}
   *             result = {foo:{bar:'ghi'}}
   *
   *         'foo' exists so we don't go any deeper
   *
   */
  var copyProperties = function(src, dst, opt_overwriteBehavior) {
    Object.keys(src).forEach(function(key) {
      if (opt_overwriteBehavior === 2 && dst[key] !== undefined) {
        return;
      }
      var value = src[key];
      if (value instanceof Array) {
        var newDst = dst[key];
        if (!newDst) {
          newDst = [];
          dst[name] = newDst;
        }
        copyProperties(value, newDst, opt_overwriteBehavior);
      } else if (value instanceof Object &&
                 !(value instanceof Function) &&
                 !(value instanceof HTMLElement)) {
        var newDst2 = dst[key];
        if (!newDst2) {
          newDst2 = {};
          dst[key] = newDst2;
        }
        copyProperties(value, newDst2, opt_overwriteBehavior);
      } else {
        if (opt_overwriteBehavior === 1 && dst[key] !== undefined) {
          return;
        }
        dst[key] = value;
      }
    });
    return dst;
  };

  function searchStringToObject(str, opt_obj) {
    if (str[0] === '?') {
      str = str.substring(1);
    }
    var results = opt_obj || {};
    str.split("&").forEach(function(part) {
      var pair = part.split("=").map(decodeURIComponent);
      results[pair[0]] = pair[1] !== undefined ? pair[1] : true;
    });
    return results;
  }

  function objectToSearchString(obj) {
    return "?" + Object.keys(obj).filter(function(key) {
      return obj[key] !== undefined;
    }).map(function(key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(obj[key]);
    }).join("&");
  }

  /**
   * Reads the query values from a URL like string.
   * @param {String} url URL like string eg. http://foo?key=value
   * @param {Object} [opt_obj] Object to attach key values to
   * @return {Object} Object with key values from URL
   * @memberOf module:Misc
   */
  var parseUrlQueryString = function(str, opt_obj) {
    var dst = opt_obj || {};
    try {
      var q = str.indexOf("?");
      var e = str.indexOf("#");
      if (e < 0) {
        e = str.length;
      }
      var query = str.substring(q + 1, e);
      searchStringToObject(query, dst);
    } catch (e) {
      console.error(e);
    }
    return dst;
  };

  /**
   * Reads the query values from the current URL.
   * @param {Object=} opt_obj Object to attach key values to
   * @return {Object} Object with key values from URL
   * @memberOf module:Misc
   */
  var parseUrlQuery = function(opt_obj) {
    return searchStringToObject(window.location.search, opt_obj);
  };

  /**
   * Read `settings` from URL. Assume settings it a
   * JSON like URL as in http://foo?settings={key:value},
   * Note that unlike real JSON we don't require quoting
   * keys if they are alpha_numeric.
   *
   * @param {Object=} opt_obj object to apply settings to.
   * @param {String=} opt_argumentName name of key for settings, default = 'settings'.
   * @return {Object} object with settings
   * @func applyUrlSettings
   * @memberOf module:Misc
   */
  var fixKeysRE = new RegExp("([a-zA-Z0-9_]+)\:", "g");

  var applyUrlSettings = function(opt_obj, opt_argumentName) {
    var argumentName = opt_argumentName || 'settings';
    var src = parseUrlQuery();
    var dst = opt_obj || {};
    var settingsStr = src[argumentName];
    if (settingsStr) {
      var json = settingsStr.replace(fixKeysRE, '"$1":');
      var settings = JSON.parse(json);
      copyProperties(settings, dst);
    }
    return dst;
  };

  /**
   * Gets a function checking for prefixed versions
   *
   * example:
   *
   *     var lockOrientation = misc.getFunctionByPrefix(window.screen, "lockOrientation");
   *
   * @param {object} obj object that has function
   * @param {string} funcName name of function
   * @return {function?} or undefined if it doesn't exist
   */
  var prefixes = ["", "moz", "webkit", "ms"];
  function getFunctionByPrefix(obj, funcName) {
    var capitalName = funcName.substr(0, 1).toUpperCase() + funcName.substr(1);
    for (var ii = 0; ii < prefixes.length; ++ii) {
      var prefix = prefixes[ii];
      var name = prefix + prefix ? capitalName : funcName;
      var func = obj[name];
      if (func) {
        return func.bind(obj);
      }
    }
  }

  /**
   * Creates an invisible iframe and sets the src
   * @param {string} src the source for the iframe
   * @return {HTMLIFrameElement} The iframe
   */
  function gotoIFrame(src) {
    var iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = src;
    document.body.appendChild(iframe);
    return iframe;
  }

  /**
   * get a random int
   * @param {number} value max value exclusive. 5 = random 0 to 4
   * @return {number} random int
   * @memberOf module:Misc
   */
  var randInt = function(value) {
    return Math.floor(Math.random() * value);
  };

  /**
   * get a random CSS color
   * @param {function(number): number?) opt_randFunc function to generate random numbers
   * @return {string} random css color
   * @memberOf module:Misc
   */
  var randCSSColor = function(opt_randFunc) {
    var randFunc = opt_randFunc || randInt;
    var strong = randFunc(3);
    var colors = [];
    for (var ii = 0; ii < 3; ++ii) {
      colors.push(randFunc(128) + (ii === strong ? 128 : 64));
    }
    return "rgb(" + colors.join(",") + ")";
  };

  /**
   * get a random 32bit color
   * @param {function(number): number?) opt_randFunc function to generate random numbers
   * @return {string} random 32bit color
   * @memberOf module:Misc
   */
  var rand32BitColor = function(opt_randFunc) {
    var randFunc = opt_randFunc || randInt;
    var strong = randFunc(3);
    var color = 0xFF;
    for (var ii = 0; ii < 3; ++ii) {
      color = (color << 8) | (randFunc(128) + (ii === strong ? 128 : 64));
    }
    return color;
  };

  /**
   * finds a CSS rule.
   * @param {string} selector
   * @return {Rule?} matching css rule
   * @memberOf module:Misc
   */
  var findCSSStyleRule = function(selector) {
    for (var ii = 0; ii < document.styleSheets.length; ++ii) {
      var styleSheet = document.styleSheets[ii];
      var rules = styleSheet.cssRules || styleSheet.rules;
      if (rules) {
        for (var rr = 0; rr < rules.length; ++rr) {
          var rule = rules[rr];
          if (rule.selectorText === selector) {
            return rule;
          }
        }
      }
    }
  };

  /**
   * Inserts a text node into an element
   * @param {HTMLElement} element element to have text node insert
   * @return {HTMLTextNode} the created text node
   * @memberOf module:Misc
   */
  var createTextNode = function(element) {
    var txt = document.createTextNode("");
    element.appendChild(txt);
    return txt;
  };

  /**
   * Returns the absolute position of an element for certain browsers.
   * @param {HTMLElement} element The element to get a position
   *        for.
   * @returns {Object} An object containing x and y as the
   *        absolute position of the given element.
   * @memberOf module:Misc
   */
  var getAbsolutePosition = function(element) {
    var r = { x: element.offsetLeft, y: element.offsetTop };
    if (element.offsetParent) {
      var tmp = getAbsolutePosition(element.offsetParent);
      r.x += tmp.x;
      r.y += tmp.y;
    }
    return r;
  };

  /**
   * Clamp value
   * @param {Number} v value to clamp
   * @param {Number} min min value to clamp to
   * @param {Number} max max value to clamp to
   * @returns {Number} v clamped to min and max.
   * @memberOf module:Misc
   */
  var clamp = function(v, min, max) {
    return Math.max(min, Math.min(max, v));
  };

  /**
   * Clamp in both positive and negative directions.
   * Same as clamp(v, -max, +max)
   *
   * @param {Number} v value to clamp
   * @param {Number} max max value to clamp to
   * @returns {Number} v clamped to -max and max.
   * @memberOf module:Misc
   */
  var clampPlusMinus = function(v, max) {
    return clamp(v, -max, max);
  };

  /**
   * Return sign of value
   *
   * @param {Number} v value
   * @returns {Number} -1 if v < 0, 1 if v > 0, 0 if v == 0
   * @memberOf module:Misc
   */
  var sign = function(v) {
    return v < 0 ? -1 : (v > 0 ? 1 : 0);
  };

  /**
   * Takes which ever is closer to zero
   * In other words minToZero(-2, -1) = -1 and minToZero(2, 1) = 1
   *
   * @param {Number} v value to min
   * @param {Number} min min value to use if v is less then -min
   *        or greater than +min
   * @returns {Number} min or v, which ever is closer to zero
   * @memberOf module:Misc
   */
  var minToZero = function(v, min) {
    return Math.abs(v) < Math.abs(min) ? v : min;
  };

  /**
   * flips 0->max to max<-0 and 0->min to min->0
   * In otherwords
   *     max: 3, v: 2.7  =  0.3
   *     max: 3, v:-2.7  = -0.3
   *     max: 3, v: 0.2  =  2.8
   *     max: 3, v:-0.2  = -2.8
   *
   * @param {Number} v value to flip.
   * @param {Number} max range to flip inside.
   * @returns {Number} flipped value.
   * @memberOf module:Misc
   */
  var invertPlusMinusRange = function(v, max) {
    return sign(v) * (max - Math.min(max, Math.abs(v)));
  };

  /**
   * Convert degrees to radians
   *
   * @param {Number} d value in degrees
   * @returns {Number} d in radians
   * @memberOf module:Misc
   */
  var degToRad = function(d) {
    return d * Math.PI / 180;
  };

  /**
   * Converts radians to degrees
   * @param {Number} r value in radians
   * @returns {Number} r in degrees
   * @memberOf module:Misc
   */
  var radToDeg = function(r) {
    return r * 180 / Math.PI;
  };

  /**
   * Resizes a cavnas to match its CSS displayed size.
   * @param {Canvas} canvas canvas to resize.
   * @param {boolean?} useDevicePixelRatio if true canvas will be
   *        created to match devicePixelRatio.
   * @memberOf module:Misc
   */
  var resize = function(canvas, useDevicePixelRatio) {
    var mult = useDevicePixelRatio ? window.devicePixelRatio : 1;
    mult = mult || 1;
    var width  = Math.floor(canvas.clientWidth  * mult);
    var height = Math.floor(canvas.clientHeight * mult);
    if (canvas.width !== width ||
        canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      return true;
    }
  };

  /**
   * Copies all the src properties to the dst
   * @param {Object} src an object with some properties
   * @param {Object} dst an object to receive copes of the properties
   * @return returns the dst object.
   */
  function applyObject(src, dst) {
    Object.keys(src).forEach(function(key) {
      dst[key] = src[key];
    });
    return dst;
  }

  /**
   * Merges the proprties of all objects into a new object
   *
   * Example:
   *
   *     var a = { abc: "def" };
   *     var b = { xyz: "123" };
   *     var c = Misc.mergeObjects(a, b);
   *
   *     // c = { abc: "def", xyz: "123" };
   *
   * Later object properties take precedence
   *
   *     var a = { abc: "def" };
   *     var b = { abc: "123" };
   *     var c = Misc.mergeObjects(a, b);
   *
   *     // c = { abc: "123" };
   *
   * @param {...Object} object objects to merge.
   * @return an object containing the merged properties
   */
  function mergeObjects(object) {  // eslint-disable-line
    var merged = {};
    Array.prototype.slice.call(arguments).forEach(function(src) {
      if (src) {
        applyObject(src, merged);
      }
    });
    return merged;
  }

  /**
   * Creates a random id
   * @param {number} [digits] number of digits. default 16
   */
  function makeRandomId(digits) {
    digits = digits || 16;
    var id = "";
    for (var ii = 0; ii < digits; ++ii) {
      id = id + ((Math.random() * 16 | 0)).toString(16);
    }
    return id;
  }

  /**
   * Applies an object of listeners to an emitter.
   *
   * Example:
   *
   *     applyListeners(someDivElement, {
   *       mousedown: someFunc1,
   *       mousemove: someFunc2,
   *       mouseup: someFunc3,
   *     });
   *
   * Which is the same as
   *
   *     someDivElement.addEventListener("mousedown", someFunc1);
   *     someDivElement.addEventListener("mousemove", someFunc2);
   *     someDivElement.addEventListener("mouseup", someFunc3);
   *
   * @param {Emitter} emitter some object that emits events and has a function `addEventListener`
   * @param {Object.<string, function>} listeners eventname function pairs.
   */
  function applyListeners(emitter, listeners) {
    Object.keys(listeners).forEach(function(name) {
      emitter.addEventListener(name, listeners[name]);
    });
  }

  return {
    applyObject: applyObject,
    applyUrlSettings: applyUrlSettings,
    applyListeners: applyListeners,
    clamp: clamp,
    clampPlusMinus: clampPlusMinus,
    copyProperties: copyProperties,
    createTextNode: createTextNode,
    degToRad: degToRad,
    findCSSStyleRule: findCSSStyleRule,
    getAbsolutePosition: getAbsolutePosition,
    getFunctionByPrefix: getFunctionByPrefix,
    gotoIFrame: gotoIFrame,
    invertPlusMinusRange: invertPlusMinusRange,
    makeRandomId: makeRandomId,
    mergeObjects: mergeObjects,
    minToZero: minToZero,
    objectToSearchString: objectToSearchString,
    parseUrlQuery: parseUrlQuery,
    parseUrlQueryString: parseUrlQueryString,
    radToDeg: radToDeg,
    randInt: randInt,
    randCSSColor: randCSSColor,
    rand32BitColor: rand32BitColor,
    resize: resize,
    sign: sign,
    searchStringToObject: searchStringToObject,
  };
});



/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


/**
 * Various hacks to try to get mobile browsers to do what I want but that
 * probably wouldn't be needed if I actually understood the platform.
 *
 * @module MobileHacks
 */
define('misc/mobilehacks',[],function() {

  var $ = document.getElementById.bind(document);

  // shit hacks for iOS8 because iOS8 barfs toolbars on the screen and
  // (a) the user can NOT dismiss them and (b) there is no way for the
  // webpage to see they exist. This only happens on iPhone 4/4s/5/s.
  //var isIOS;
  var shittyOldIPhoneWithShittyIOS8Plus = function() {
    var iPhone4 = (window.screen.height === (960 / 2));
    var iPhone5 = (window.screen.height === (1136 / 2));
    var iOS8Plus = function() {
      if (/iP(hone|od|ad)/.test(navigator.platform)) {
        // supports iOS 2.0 and later: <http://bit.ly/TJjs1V>
        var v = (navigator.appVersion).match(/OS (\d+)_(\d+)_?(\d+)?/);
        //isIOS = true;
        return parseInt(v[1], 10) >= 8;
      }
    }();
    return iOS8Plus && (iPhone4 || iPhone5);
  }();

  var isIOS8OrNewerAndiPhone4OrIPhone5 = function() {
    return shittyOldIPhoneWithShittyIOS8Plus;
  };

  var isIOS = function() {
    var itsIOS = (/iP(hone|od|ad)/i).test(navigator.platform);
    return function() {
      return itsIOS;
    };
  }();

  var isMobile = function() {
    // yes I know I should feature detect. FUCK YOU!
    var mobile = (/Android|webOS|Phone|Pad|Pod|Tablet|BlackBerry/i).test(navigator.userAgent);
    return function() {
      return mobile;
    };
  }();

  /**
   * resets the height of any element with CSS class "fixeight"
   * by setting its hight to the cliehgtHeight of its parent
   *
   * The problem this is trying to solve is sometimes you have
   * an element set to 100% but when the phone rotates
   * the browser does not reset the size of the element even
   * though it's parent has been resized.
   *
   * This will be called automatically when the phone rotates
   * or the window is resized but I found I often needed to
   * call it manually at the start of a controller
   *
   * @memberOf module:MobileHacks
   */
  var fixHeightHack = function() {
    // Also fix all fucked up sizing
    var elements = document.querySelectorAll(".fixheight");
    for (var ii = 0; ii < elements.length; ++ii) {
      var element = elements[ii];
      var parent = element.parentNode;
      if (parseInt(element.style.height) !== parent.clientHeight) {
        element.style.height = parent.clientHeight + "px";
      }
    }
  };

  var adjustCSSBasedOnPhone = function(perPhoneClasses) {
    perPhoneClasses.forEach(function(phone) {
      if (phone.test()) {
        Array.prototype.forEach.call(document.styleSheets, function(sheet) {
          var classes = sheet.rules || document.sheet.cssRules;
          Array.prototype.forEach.call(classes, function(c) {
            var adjustments = phone.styles[c.selectorText];
            if (adjustments) {
              Object.keys(adjustments).forEach(function(key) {
//console.log(key + ": old " + c.style[key]);
                if (c.style.setProperty) {
                  c.style.setProperty(key, adjustments[key]);
                } else {
                  c.style[key] = adjustments[key];
                }
//console.log(key + ": new " + c.style[key]);
              });
            }
          });
        });
      }
    });
  };

  var fixupAfterSizeChange = function() {
    window.scrollTo(0, 0);
    fixHeightHack();
    window.scrollTo(0, 0);
  };

  // When the device re-orients, at least on iOS, the page is scrolled down :(
  window.addEventListener('orientationchange', fixupAfterSizeChange, false);
  window.addEventListener('resize', fixupAfterSizeChange, false);

  // Prevents the browser from sliding the page when the user slides their finger.
  // At least on iOS.
  var stopSliding = function() {
    if (!document.body) {
      setTimeout(stopSliding, 4);
    } else {
      document.body.addEventListener('touchmove', function(e) {
        e.preventDefault();
      }, false);
    }
  };
  stopSliding();


  // This DOESN'T WORK! I'm leaving it here so I can revisit it.
  // The issue is all kinds of things mess up. Events are not rotated,
  // the page does strange things.
  var forceLandscape = function() {
    // Note: This code is for games that require a certain orientation
    // on phones only. I'm making the assuption that tablets don't need
    // this.
    //
    // The issue I ran into is I tried to show several people games
    // and they had their phone orientation locked to portrait. Having
    // to go unlock just to play the game was frustrating. So, for
    // controllers than require landscape just try to make the page
    // show up in landscape. They'll understand they need to turn the phone.
    //
    // If the orientation is unlocked they'll turn and the page will
    // switch to landscape. If the orientation is locked then turning
    // the phone will not switch to landscape NOR will we get an orientation
    // event.
    var everything = $("hft-everything");
    var detectPortrait = function() {
      if (screen.width < screen.height) {
        everything.className = "hft-portrait-to-landscape";
        everything.style.width = window.innerHeight + "px";
        everything.style.height = window.innerWidth + "px";

        var viewport = document.querySelector("meta[name=viewport]");
        viewport.setAttribute('content', 'width=device-height, initial-scale=1.0, maximum-scale=1, user-scalable=no, minimal-ui');
      } else {
        everything.className = "";
      }
    };

    detectPortrait();
    window.addEventListener('resize', detectPortrait, false);
  };

  function preventEvent(e) {
    e.preventDefault();
    return false;
  }

  /**
   * Disable the context menus!
   * At least on Android if you long press on an image it asks if you
   * want to save it. I'd think "user-select: none" CSS should handle that
   * but nope
   */
  function disableContextMenu() {
    // for now just images.
    Array.prototype.forEach.call(document.getElementsByTagName("img"), function(img) {
      img.addEventListener('contextmenu', preventEvent, false);
    });
  }


  window.scrollTo(0, 0);

  return {
    disableContextMenu: disableContextMenu,
    fixHeightHack: fixHeightHack,
    forceLandscape: forceLandscape,
    adjustCSSBasedOnPhone: adjustCSSBasedOnPhone,
    isIOS8OrNewerAndiPhone4OrIPhone5: isIOS8OrNewerAndiPhone4OrIPhone5,
    isIOS: isIOS,
    isMobile: isMobile,
  };
});


/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


define('misc/orientation',[
    './misc',
  ], function(
    misc) {

  var lockOrientation = misc.getFunctionByPrefix(window.screen, "lockOrientation");
  var unlockOrientation = misc.getFunctionByPrefix(window.screen, "unlockOrientation");
  var currentOrientation = "none";
  var _canOrient = true;

  if (window.screen.orientation && window.screen.orientation.lock) {
    lockOrientation = function(orientation) {
      window.screen.orientation.lock(orientation).then(function() {
        console.log("orientation set");
      }, function(err) {
        console.error("can not set orientation:", err);
      });
    };
    unlockOrientation = function() {
      window.screen.orientation.unlock().then(function() {
        console.log("orientation unlocked");
      }, function(err) {
        console.error("can not unlock orientation:", err);
      });
    };
  }

  if (!lockOrientation) {
    _canOrient = false;
    lockOrientation = function() {
      console.warn("orientation locking not supported");
    };
    unlockOrientation = function() {
    };
  }

  /**
   * Sets the orientation of the screen
   * @param {string} [orienation] The orientation to set the phone.
   *   Only works on Android or the App.
   *
   *   Valid values are:
   *
   *     "portrait-primary"    // normal way people hold phones
   *     "portrait-secondary"  // upsidedown
   *     "landscape-primary"   // phone turned clockwise 90 degrees from normal
   *     "landscape-secondary" // phone turned counter-clockwise 90 degrees from normal
   *     "none" (or undefined) // unlocked
   */
  function set(orientation) {
    orientation = orientation || "none";
    if (orientation !== currentOrientation) {
      currentOrientation = orientation;
      if (currentOrientation === "none") {
        console.log("unlock orienation");
        unlockOrientation();
      } else {
        console.log("set orienation: " + orientation);
        lockOrientation(orientation);
      }
    }
  }

  /**
   * Returns true if orientation is supported.
   * @return {boolean} true if orientation is supported
   */
  function canOrient() {
    return _canOrient;
  }

  return {
    set: set,
    canOrient: canOrient,
  };
});

/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


/**
 * Implements the common UI parts of HappyFunTimes for
 * contollers.
 * @module CommonUI
 */
define('commonui',[
    './io',
    './misc/cookies',
    './misc/dialog',
    './misc/fullscreen',
    './misc/logger',
    './misc/misc',
    './misc/mobilehacks',
    './misc/orientation',
  ], function(
    IO,
    Cookie,
    dialog,
    fullScreen,
    logger,
    misc,
    mobilehacks,
    orientation) {

  var $ = function(id) {
    return document.getElementById(id);
  };

  var g = {
    logger: new logger.NullLogger(),
  };

  var requireLandscapeHTML = [
      '<div id="hft-portrait" class="hft-fullsize hft-fullcenter">',
      '  <div class="hft-portrait-rot90">                         ',
      '    <div class="hft-instruction">                          ',
      '      Turn the Screen                                      ',
      '    </div>                                                 ',
      '    <div class="hft-xlarge">                               ',
      '      &#x21ba;                                             ',
      '    </div>                                                 ',
      '  </div>                                                   ',
      '</div>                                                     ',
  ].join("\n");
  var requirePortraitHTML = [
    '<div id="hft-landscape" class="hft-fullsize hft-fullcenter">',
    '  <div class="hft-landscape-rot90">                         ',
    '    <div class="hft-instruction">                           ',
    '      Turn the Screen                                       ',
    '    </div>                                                  ',
    '    <div class="hft-xlarge">                                ',
    '      &#x21bb;                                              ',
    '    </div>                                                  ',
    '  </div>                                                    ',
    '</div>                                                      ',
  ].join("\n");
  var orientationDiv;

  //function isSemiValidOrientation(o) {
  //  o = o || "";
  //  return o.indexOf("portrait") >= 0 || o.indexOf("landscape") >= 0;
  //}

  function setOrientationHTML(desiredOrientation) {
    desiredOrientation = desiredOrientation || "";
    if (!orientationDiv) {
      orientationDiv = document.createElement("div");
      //document.body.appendChild(orientationDiv);
      var h = document.getElementById("hft-menu");
      h.parentNode.insertBefore(orientationDiv, h);
    }
    if (desiredOrientation.indexOf("portrait") >= 0) {
      orientationDiv.innerHTML = requirePortraitHTML;
    } else if (desiredOrientation.indexOf("landscape") >= 0) {
      orientationDiv.innerHTML = requireLandscapeHTML;
    } else {
      orientationDiv.innerHTML = "";
    }
  }

  function resetOrientation() {
    if (fullScreen.isFullScreen()) {
      orientation.set(g.orientation);
    }
  }

  /**
   * Sets the orientation of the screen. Doesn't work on desktop
   * nor iOS unless in app.
   * @param {string} [desiredOrientation] The orientation. Valid options are
   *
   *     "portrait-primary"    // normal way people hold phones
   *     "portrait-secondary"  // upsidedown
   *     "landscape-primary"   // phone turned clockwise 90 degrees from normal
   *     "landscape-secondary" // phone turned counter-clockwise 90 degrees from normal
   *     "none" (or undefined) // unlocked
   * @param {bool} [orientationOptional]
   */
  function setOrientation(desiredOrientation, orientationOptional) {
    orientationOptional = orientationOptional;

    g.orientation = desiredOrientation;
    if (orientation.canOrient()) {
      resetOrientation();
    } else {
      var orient = g.orientation;
      if (orientationOptional) {
        orient = "none";
      }
      setOrientationHTML(orient);
    }
  }

  /**
   * @typedef {Object} ControllerUI~Options
   * @property {callback} [connectFn] function to call when controller
   *           connects to HappyFunTimes
   * @property {callback} [disconnectFn] function to call when controller is
   *           disconncted from game.
   * @property {boolean} [debug] True displays a status and debug
   *           html element
   * @property {number} [numConsoleLines] number of lines to show for the debug console.
   * @property {string} [orienation] The orientation to set the phone. Only works on Android or the App. See {@link setOrientation}.
   * @property {boolean} [orientationOptional] Don't ask the user to orient the phone if their device does not support orientation
   * @property {boolean} [requireApp] If true and we're not in the app will present a dialog saying you must use the app
   * @memberOf module:CommonUI
   */

  /**
   * Sets up the standard UI for a happyFunTimes controller
   * (phone). Including handling being disconnected from the
   * current game and switching to new games as well as name
   * input and the gear menu.
   *
   * @param {GameClient} client The `GameClient` for the phone
   * @param {module:CommonUI.ControllerUI~Options} [options] the options
   * @memberOf module:CommonUI
   */
  var setupStandardControllerUI = function(client, options) {
    options = options || {};
    var hftSettings = window.hftSettings || {};
    var menuElement = $("hft-menu");
    var disconnectedElement = $("hft-disconnected");

//    menuElement.addEventListener('click', function() {
//      settingsElement.style.display = "block";
//    });

    // setup full screen support
    var requestFullScreen = function() {
      if (!fullScreen.isFullScreen()) {
        touchStartElement.removeEventListener('touchstart', requestFullScreen, false);
        touchStartElement.style.display = "none";
        fullScreen.requestFullScreen(document.body);
      }
    };

    var goFullScreenIfNotFullScreen = function() {
      if (fullScreen.isFullScreen()) {
        resetOrientation();
      } else {
        if (fullScreen.canGoFullScreen()) {
          touchStartElement.addEventListener('touchstart', requestFullScreen, false);
          touchStartElement.style.display = "block";
        }
      }
    };
    fullScreen.onFullScreenChange(document.body, goFullScreenIfNotFullScreen);

    if (mobilehacks.isMobile()) {
       goFullScreenIfNotFullScreen();
    }

//    $("hft-mainmenu").addEventListener('click', function() {
//      window.location.href = "/";
//    }, false);
//    $("hft-reload").addEventListener('click', function() {
//      window.location.reload();
//    });

    setOrientation(options.orientation, options.orientationOptional);
  };

  /**
   * Sets the content of the status element. Only visible of debug
   * is true.
   * @memberOf module:CommonUI
   * @param {string} str value to set the status
   */
  var setStatus = function(msg) {
    if (g.statusNode) {
      g.statusNode.nodeValue = msg;
    }
  };

  /**
   * Logs a msg to the HTML based console that is only visible
   * when debug = true.
   * @memberOf module:CommonUI
   * @param {string} str msg to add to log
   */
  var log = function(str) {
    g.logger.log(str);
  };

  /**
   * Logs an error to the HTML based console that is only visible
   * when debug = true.
   * @memberOf module:CommonUI
   * @param {string} str msg to add to log
   */
  var error = function(str) {
    g.logger.error(str);
  };

  return {
    log: log,
    error: error,
    setOrientation: setOrientation,
    setStatus: setStatus,
    setupStandardControllerUI: setupStandardControllerUI,
  };
});




/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


/**
 * Various functions to help with user input
 * @module Input
 */
define('misc/input',['./misc'], function(Misc) {

  /**
   * The cursor key values. Can be used to register keys
   * @enum {number}
   * @memberOf module:Input
   */
  var cursorKeys = {
    kLeft: 37,
    kRight: 39,
    kUp: 38,
    kDown: 40,
  };

  /**
   * You can use these to make your own options for setupKeyboardDPadKeys
   * @const {number[]} kCursorKeys
   * @memberOf module:Input
   */
  var kCursorKeys = [37, 39, 38, 40];
  /**
   * You can use these to make your own options for setupKeyboardDPadKeys
   * @const {number[]} kASWDKeys
   * @memberOf module:Input
   */
  var kASWDKeys = [65, 68, 87, 83];

  /**
   * You can use these to make your own options for setupKeyboardDPadKeys
   *
   *     Input.setupKeyboardDPadKeys(callback, Input.kASWDPadOnly);
   *
   * @const {module:Input.DPadKeys~Options} kASWDPadOnly
   * @memberOf module:Input
   */
  var kASWDPadOnly = {
    pads: [
      { keys: kASWDKeys, },
    ],
  };
  /**
   * You can use these to make your own options for setupKeyboardDPadKeys
   *
   *     Input.setupKeyboardDPadKeys(callback, Input.kCursorPadOnly);
   *
   * @const {module:Input.DPadKeys~Options} kCursorPadOnly
   * @memberOf module:Input
   */
  var kCursorPadOnly = {
    pads: [
      { keys: kCursorKeys, },
    ],
  };

  var isNumRE = /^\d+$/;

  // Provides a map from direction to various info.
  //
  // Example:
  //
  //   Input.setupKeyboardDPadsKeys(container, function(event) {
  //     console.log("dir: " + event.info.symbol]);
  //   });
  var RIGHT = 0x1;
  var LEFT = 0x2;
  var UP = 0x4;
  var DOWN = 0x8;

  /**
   * Various info for a given 8 direction direction.
   *
   *        2     -1 = no touch
   *      3 | 1
   *       \|/
   *     4--+--0
   *       /|\
   *      5 | 7
   *        6
   *
   * @typedef {Object} DirectionInfo
   * @memberOf module:Input
   * @property {number} direction -1 to 7
   * @property {number} dx -1, 0, or 1
   * @property {number} dy -1, 0, or 1
   * @property {number} bits where `R = 0x1, L = 0x2, U = 0x4, D =
   *           0x8`
   * @property {string} unicode arrow simple for direction.
   */

  var dirInfo = { };
  dirInfo[-1] = { direction: -1, dx:  0, dy:  0, bits: 0           , symbol: String.fromCharCode(0x2751), };
  dirInfo[ 0] = { direction:  0, dx:  1, dy:  0, bits: RIGHT       , symbol: String.fromCharCode(0x2192), }; // right
  dirInfo[ 1] = { direction:  1, dx:  1, dy:  1, bits: UP | RIGHT  , symbol: String.fromCharCode(0x2197), }; // up-right
  dirInfo[ 2] = { direction:  2, dx:  0, dy:  1, bits: UP          , symbol: String.fromCharCode(0x2191), }; // up
  dirInfo[ 3] = { direction:  3, dx: -1, dy:  1, bits: UP | LEFT   , symbol: String.fromCharCode(0x2196), }; // up-left
  dirInfo[ 4] = { direction:  4, dx: -1, dy:  0, bits: LEFT        , symbol: String.fromCharCode(0x2190), }; // left
  dirInfo[ 5] = { direction:  5, dx: -1, dy: -1, bits: DOWN | LEFT , symbol: String.fromCharCode(0x2199), }; // down-left
  dirInfo[ 6] = { direction:  6, dx:  0, dy: -1, bits: DOWN        , symbol: String.fromCharCode(0x2193), }; // down
  dirInfo[ 7] = { direction:  7, dx:  1, dy: -1, bits: DOWN | RIGHT, symbol: String.fromCharCode(0x2198), }; // down-right

  /**
   * @typedef {Object} EventInfo
   * @property {number} pad the pad id 0, 1, 2, etc.
   * @property {module:Input.DirectionInfo} info the direction
   *           info for the event.
   * @memberOf module:Input
   */

  /**
   * Creates an EventInfo for a given padId
   * @returns {module:Input.EventInfo}
   * @memberOf module:Input
   */
  var createDirectionEventInfo = function(padId) {
    return {
      pad: padId,
      info: undefined,
    };
  };

  /**
   * @param {number} padId id of pad. eg. 0, 1, 2
   * @param {number} direction direction pad is being pressed -1
   *        to 7.
   * @param {EventInfo} eventInfo from createDirectionEventInfo.
   * @param {callback} callback to pass eventInfo once it's been
   *        filled out.
   * @memberOf module:Input
   */
  var emitDirectionEvent = function(padId, direction, eventInfo, callback) {
    var info = dirInfo[direction];
    eventInfo.pad = padId;
    eventInfo.info = info;
    callback(eventInfo);
  };

  /**
   * Given a direction returns a direction info
   * @param {number} direction -1 to 7
   * @return {module:Input.DirectionInfo}
   * @memberOf module:Input
   */
  var getDirectionInfo = function(direction) {
    return dirInfo[direction];
  };

  /**
   * @typedef {Object} Coordinate
   * @property {number} x the x coordinate
   * @property {number} y the y coordinate
   * @memberOf module:Input
   */

  /**
   * Gets the relative coordinates for an event
   * @func
   * @param {HTMLElement} reference html elemetn to reference
   * @param {Event} event from HTML mouse event
   * @returns {module:Input.Coordinate} the relative position
   * @memberOf module:Input
   */
  var getRelativeCoordinates = function(reference, event) {
    // Use absolute coordinates
    var pos = Misc.getAbsolutePosition(reference);
    var x = event.pageX - pos.x;
    var y = event.pageY - pos.y;
    return { x: x, y: y };
  };

  /**
   * Sets up controller key functions
   * @param {callback(code, down)} keyDownFn a function to be
   *        called when a key is pressed. It's passed the keycode
   *        and true.
   * @param {callback(code, down)} keyUpFn a function to be called
   *        when a key is released. It's passed the keycode and
   *        false.
   * @memberOf module:Input
   */
  var setupControllerKeys = function(keyDownFn, keyUpFn) {
    var g_keyState = {};
    var g_oldKeyState = {};

    var updateKey = function(keyCode, state) {
      g_keyState[keyCode] = state;
      if (g_oldKeyState !== g_keyState) {
        g_oldKeyState = state;
        if (state) {
          keyDownFn(keyCode);
        } else {
          keyUpFn(keyCode);
        }
      }
    };

    var keyUp = function(event) {
      updateKey(event.keyCode, false);
    };

    var keyDown = function(event) {
      updateKey(event.keyCode, true);
    };

    window.addEventListener("keyup", keyUp, false);
    window.addEventListener("keydown", keyDown, false);
  };

  /**
   * @typedef {Object} DPadKeys
   * @property {number[]} keys Array of 4 key codes that make a
   *           keyboard dpad in LRUD order.
   * @memberOf module:Input
   */

  /**
   * @typedef {Object} DPadKeys~Options
   * @property {module:Input.DPadKeys[]} pads Array of dpad keys
   * @memberOf module:Input
   */

  /**
   * Simulates N virtual dpads using keys
   * asdw for pad 0, arrow keys for pad 1
   *
   * For each change in direction callback will be
   * called with pad id (0 left, 1 right) and direction
   * where
   *
   *        2     -1 = not pressed
   *      3 | 1
   *       \|/
   *     4--+--0
   *       /|\
   *      5 | 7
   *        6
   *
   * Note: this matches trig functions you can do this
   *
   *     var angle = dir * Math.PI / 4;
   *     var dx    = Math.cos(angle);
   *     var dy    = Math.sin(angle);
   *
   * for +y up (ie, normal for 3d)
   *
   * In 2d you'd probably want
   *
   *     var angle =  dir * Math.PI / 4;
   *     var dx    =  Math.cos(angle);
   *     var dy    = -Math.sin(angle);
   *
   *
   * @param {callback} callback callback will be called with
   *        EventInfo objects when pads change their direction
   * @param {module:Input.DPadKeys~Options?} options If no options
   *        are passed in assumes 2 DPads one on ASWD the other on
   *        the cursor keys
   * @memberOf module:Input
   */
  var setupKeyboardDPadKeys = function(callback, options) {
    if (!options) {
      options = {
        pads: [
         { keys: kASWDKeys,   }, // LRUD
         { keys: kCursorKeys, }, // LRUD
        ],
      };
    }

    var g_dirBits = [];
    var g_excludeBits = [];
    var g_dir = [];
    var g_eventInfos = [];

    var bitInfos = [
      { bit: 1, exclude: 2, mask: 0x3 }, // left
      { bit: 2, exclude: 1, mask: 0x3 }, // right
      { bit: 4, exclude: 8, mask: 0xC }, // up
      { bit: 8, exclude: 4, mask: 0xC }, // down
    ];

    var keyToBit = { };

    for (var ii = 0; ii < options.pads.length; ++ii) {
      var pad = options.pads[ii];
      g_dirBits.push(0);
      g_excludeBits.push(0);
      g_dir.push(-1);
      g_eventInfos.push(createDirectionEventInfo(ii));
      for (var kk = 0; kk < 4; ++kk) {
        var bitInfo = bitInfos[kk];
        var keyInfo = { pad: ii, };
        Misc.copyProperties(bitInfo, keyInfo);
        keyToBit[pad.keys[kk]] = keyInfo;
      }
    }

    var bitsToDir = [
      -1, // 0
       4, // 1      l
       0, // 2     r
      -1, // 3     rl
       2, // 4    u
       3, // 5    u l
       1, // 6    ur
      -1, // 7    url
       6, // 8   d
       5, // 9   d  l
       7, // 10  d r
      -1, // 11  d rl
      -1, // 12  du
      -1, // 13  du l
      -1, // 14  dur
      -1, // 15  durl
    ];

    var setBit = function(keyCode, value) {
      // get info for this key
      var info = keyToBit[keyCode];
      if (info) {
        // or in or and out bit for button
        var pad = info.pad;
        var bit = info.bit;
        var bits = g_dirBits[pad];
        if (value) {
          bits |= bit;
          g_excludeBits[pad] = (g_excludeBits[pad] & ~info.mask) | info.exclude;
        } else {
          bits &= ~bit;
          g_excludeBits[pad] &= ~info.mask;
        }
        // If they've changed
        if (bits !== g_dirBits[pad]) {
          g_dirBits[pad] = bits;
          var dir = bitsToDir[bits & ~g_excludeBits[pad]];
          // If the dir has changed.
          if (dir !== g_dir[pad]) {
            g_dir[pad] = dir;
            emitDirectionEvent(pad, dir, g_eventInfos[pad], callback);
          }
        }
      }
    };

    var keyUp = function(keyCode) {
      setBit(keyCode, 0);
    };

    var keyDown = function(keyCode) {
      setBit(keyCode, 1);
    };

    setupControllerKeys(keyDown, keyUp);
  };

  /**
   * @typedef {Object} KeyEvent
   * @property {number} keyCode
   * @property {boolean} pressed true if pressed, false if
   *           released
   * @memberOf module:Input
   */

  /**
   * Sets up handlers for specific keys
   * @memberOf module:Input
   * @param {Object.<string, callback>} array of keys to handler
   *        functions. Handlers are called with a KeyEvent
   *
   * @example
   *
   *      var keys = { };
   *      keys["Z".charCodeAt(0)] = handleJump;
   *      keys["X".charCodeAt(0)] = handleShow
   *      keys["C".charCodeAt(0)] = handleTestSound;
   *      keys[Input.cursorKeys.kRight] = handleMoveRight;
   *      Input.setupKeys(keys);
   *
   */
  var setupKeys = function(keys) {
    var keyCodes = {};

    // Convert single characters to char codes.
    Object.keys(keys).forEach(function(key) {
      var value = keys[key];
      if (!isNumRE.test(key)) {
        if (key.length !== 1) {
          throw "bad key code: '" + key + "'";
        }
        key = key.charCodeAt(0);
      }
      keyCodes[key] = value;
    });

    var handleKey = function(keyCode, state, pressed) {
      var key = keyCodes[keyCode];
      if (key) {
        key({keyCode: keyCode, pressed:pressed});
      }
    };

    var handleKeyDown = function(keyCode, state) {
      handleKey(keyCode, state, true);
    };
    var handleKeyUp = function(keyCode, state) {
      handleKey(keyCode, state, false);
    };

    setupControllerKeys(handleKeyDown, handleKeyUp);
  };

  return {
    cursorKeys: cursorKeys,
    createDirectionEventInfo: createDirectionEventInfo,
    emitDirectionEvent: emitDirectionEvent,
    getDirectionInfo: getDirectionInfo,
    kCursorKeys: kCursorKeys,
    kCursorPadOnly: kCursorPadOnly,
    kASWDKeys: kASWDKeys,
    kASWDPadOnly: kASWDPadOnly,
    getRelativeCoordinates: getRelativeCoordinates,
    setupControllerKeys: setupControllerKeys,
    setupKeyboardDPadKeys: setupKeyboardDPadKeys,
    setupKeys: setupKeys,
  };
});


/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


/**
 * Miscellaneous string functions
 * @module Strings
 */
define('misc/strings',[],function() {

  /**
   * Returns a padding string large enough for the given size.
   * @param {string} padChar character for padding string
   * @param {number} len minimum length of padding.
   * @returns {string} string with len or more of padChar.
   */
  var getPadding = (function() {
    var paddingDb = {};

    return function(padChar, len) {
      var padStr = paddingDb[padChar];
      if (!padStr || padStr.length < len) {
        padStr = new Array(len + 1).join(padChar);
        paddingDb[padChar] = padStr;
      }
      return padStr;
    };
  }());

  /**
   * Turn an unknown object into a string if it's not already.
   * Do I really needs this? I could just always do .toString even
   * on a string.
   */
  var stringIt = function(str) {
    return (typeof str === 'string') ? str : str.toString();
  };

  /**
   * Pad string on right
   * @param {string} str string to pad
   * @param {number} len number of characters to pad to
   * @param {string} padChar character to pad with
   * @returns {string} padded string.
   * @memberOf module:Strings
   */
  var padRight = function(str, len, padChar) {
    str = stringIt(str);
    if (str.length >= len) {
      return str;
    }
    var padStr = getPadding(padChar, len);
    return str + padStr.substr(str.length - len);
  };

  /**
   * Pad string on left
   * @param {string} str string to pad
   * @param {number} len number of characters to pad to
   * @param {string} padChar character to pad with
   * @returns {string} padded string.
   * @memberOf module:Strings
   */
  var padLeft = function(str, len, padChar) {
    str = stringIt(str);
    if (str.length >= len) {
      return str;
    }
    var padStr = getPadding(padChar, len);
    return padStr.substr(str.length - len) + str;
  };

  /**
   * Replace %(id)s in strings with values in objects(s)
   *
   * Given a string like `"Hello %(name)s from $(user.country)s"`
   * and an object like `{name:"Joe",user:{country:"USA"}}` would
   * return `"Hello Joe from USA"`.
   *
   * @function
   * @param {string} str string to do replacements in
   * @param {Object|Object[]} params one or more objects.
   * @returns {string} string with replaced parts
   * @memberOf module:Strings
   */
  var replaceParams = (function() {
    var replaceParamsRE = /%\(([^\)]+)\)s/g;

    return function(str, params) {
      if (!params.length) {
        params = [params];
      }

      return str.replace(replaceParamsRE, function(match, key) {
        var keys = key.split('.');
        for (var ii = 0; ii < params.length; ++ii) {
          var obj = params[ii];
          for (var jj = 0; jj < keys.length; ++jj) {
            var part = keys[jj];
            obj = obj[part];
            if (obj === undefined) {
              break;
            }
          }
          if (obj !== undefined) {
            return obj;
          }
        }
        console.error("unknown key: " + key);
        return "%(" + key + ")s";
      });
    };
  }());

  /**
   * True if string starts with prefix
   * @static
   * @param {String} str string to check for start
   * @param {String} prefix start value
   * @returns {Boolean} true if str starts with prefix
   * @memberOf module:Strings
   */
  var startsWith = function(str, start) {
    return (str.length >= start.length &&
            str.substr(0, start.length) === start);
  };

  /**
   * True if string ends with suffix
   * @param {String} str string to check for start
   * @param {String} suffix start value
   * @returns {Boolean} true if str starts with suffix
   * @memberOf module:Strings
   */
  var endsWith = function(str, end) {
    return (str.length >= end.length &&
            str.substring(str.length - end.length) === end);
  };

  /**
   * Make a string from unicode code points
   * @function
   * @param {Number} codePoint one or more code points
   * @returns {string} unicode string. Note a single code point
   *          can return a string with length > 1.
   * @memberOf module:Strings
   */
  var fromCodePoint = String.fromCodePoint ? String.fromCodePoint : (function() {
    var stringFromCharCode = String.fromCharCode;
    var floor = Math.floor;
    var fromCodePoint = function() {
      var MAX_SIZE = 0x4000;
      var codeUnits = [];
      var highSurrogate;
      var lowSurrogate;
      var index = -1;
      var length = arguments.length;
      if (!length) {
        return '';
      }
      var result = '';
      while (++index < length) {
        var codePoint = Number(arguments[index]);
        if (
          !isFinite(codePoint) || // `NaN`, `+Infinity`, or `-Infinity`
          codePoint < 0 || // not a valid Unicode code point
          codePoint > 0x10FFFF || // not a valid Unicode code point
          floor(codePoint) !== codePoint // not an integer
        ) {
          throw new RangeError('Invalid code point: ' + codePoint);
        }
        if (codePoint <= 0xFFFF) { // BMP code point
          codeUnits.push(codePoint);
        } else { // Astral code point; split in surrogate halves
          // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
          codePoint -= 0x10000;
          highSurrogate = (codePoint >> 10) + 0xD800;
          lowSurrogate = (codePoint % 0x400) + 0xDC00;
          codeUnits.push(highSurrogate, lowSurrogate);
        }
        if (index + 1 === length || codeUnits.length > MAX_SIZE) {
          result += stringFromCharCode.apply(null, codeUnits);
          codeUnits.length = 0;
        }
      }
      return result;
    };
    return fromCodePoint;
  }());

  var exports = {
    endsWith: endsWith,
    fromCodePoint: fromCodePoint,
    padLeft: padLeft,
    padRight: padRight,
    replaceParams: replaceParams,
    startsWith: startsWith,
  };

  return exports;
});



/*!
 * PEP v0.4.1 | https://github.com/jquery/PEP
 * Copyright jQuery Foundation and other contributors | http://jquery.org/license
 */
!function(a,b){"object"==typeof exports&&"undefined"!=typeof module?module.exports=b():"function"==typeof define&&define.amd?define('misc/../../3rdparty/pep.min',b):a.PointerEventsPolyfill=b()}(this,function(){"use strict";function a(a,b){b=b||Object.create(null);var c=document.createEvent("Event");c.initEvent(a,b.bubbles||!1,b.cancelable||!1);for(var d,e=2;e<k.length;e++)d=k[e],c[d]=b[d]||l[e];c.buttons=b.buttons||0;var f=0;return f=b.pressure?b.pressure:c.buttons?.5:0,c.x=c.clientX,c.y=c.clientY,c.pointerId=b.pointerId||0,c.width=b.width||0,c.height=b.height||0,c.pressure=f,c.tiltX=b.tiltX||0,c.tiltY=b.tiltY||0,c.pointerType=b.pointerType||"",c.hwTimestamp=b.hwTimestamp||0,c.isPrimary=b.isPrimary||!1,c}function b(){this.array=[],this.size=0}function c(a,b,c,d){this.addCallback=a.bind(d),this.removeCallback=b.bind(d),this.changedCallback=c.bind(d),B&&(this.observer=new B(this.mutationWatcher.bind(this)))}function d(a){return"body /shadow-deep/ "+e(a)}function e(a){return'[touch-action="'+a+'"]'}function f(a){return"{ -ms-touch-action: "+a+"; touch-action: "+a+"; touch-action-delay: none; }"}function g(){if(H){F.forEach(function(a){String(a)===a?(G+=e(a)+f(a)+"\n",I&&(G+=d(a)+f(a)+"\n")):(G+=a.selectors.map(e)+f(a.rule)+"\n",I&&(G+=a.selectors.map(d)+f(a.rule)+"\n"))});var a=document.createElement("style");a.textContent=G,document.head.appendChild(a)}}function h(){if(!window.PointerEvent){if(window.PointerEvent=m,window.navigator.msPointerEnabled){var a=window.navigator.msMaxTouchPoints;Object.defineProperty(window.navigator,"maxTouchPoints",{value:a,enumerable:!0}),v.registerSource("ms",ea)}else v.registerSource("mouse",Q),void 0!==window.ontouchstart&&v.registerSource("touch",aa);v.register(document)}}function i(a){if(!v.pointermap.has(a))throw new Error("InvalidPointerId")}function j(){window.Element&&!Element.prototype.setPointerCapture&&Object.defineProperties(Element.prototype,{setPointerCapture:{value:$},releasePointerCapture:{value:_}})}var k=["bubbles","cancelable","view","detail","screenX","screenY","clientX","clientY","ctrlKey","altKey","shiftKey","metaKey","button","relatedTarget","pageX","pageY"],l=[!1,!1,null,null,0,0,0,0,!1,!1,!1,!1,0,null,0,0],m=a,n=window.Map&&window.Map.prototype.forEach,o=n?Map:b;b.prototype={set:function(a,b){return void 0===b?this["delete"](a):(this.has(a)||this.size++,void(this.array[a]=b))},has:function(a){return void 0!==this.array[a]},"delete":function(a){this.has(a)&&(delete this.array[a],this.size--)},get:function(a){return this.array[a]},clear:function(){this.array.length=0,this.size=0},forEach:function(a,b){return this.array.forEach(function(c,d){a.call(b,c,d,this)},this)}};var p=o,q=["bubbles","cancelable","view","detail","screenX","screenY","clientX","clientY","ctrlKey","altKey","shiftKey","metaKey","button","relatedTarget","buttons","pointerId","width","height","pressure","tiltX","tiltY","pointerType","hwTimestamp","isPrimary","type","target","currentTarget","which","pageX","pageY","timeStamp"],r=[!1,!1,null,null,0,0,0,0,!1,!1,!1,!1,0,null,0,0,0,0,0,0,0,"",0,!1,"",null,null,0,0,0,0],s={pointerover:1,pointerout:1,pointerenter:1,pointerleave:1},t="undefined"!=typeof SVGElementInstance,u={pointermap:new p,eventMap:Object.create(null),captureInfo:Object.create(null),eventSources:Object.create(null),eventSourceList:[],registerSource:function(a,b){var c=b,d=c.events;d&&(d.forEach(function(a){c[a]&&(this.eventMap[a]=c[a].bind(c))},this),this.eventSources[a]=c,this.eventSourceList.push(c))},register:function(a){for(var b,c=this.eventSourceList.length,d=0;c>d&&(b=this.eventSourceList[d]);d++)b.register.call(b,a)},unregister:function(a){for(var b,c=this.eventSourceList.length,d=0;c>d&&(b=this.eventSourceList[d]);d++)b.unregister.call(b,a)},contains:function(a,b){try{return a.contains(b)}catch(c){return!1}},down:function(a){a.bubbles=!0,this.fireEvent("pointerdown",a)},move:function(a){a.bubbles=!0,this.fireEvent("pointermove",a)},up:function(a){a.bubbles=!0,this.fireEvent("pointerup",a)},enter:function(a){a.bubbles=!1,this.fireEvent("pointerenter",a)},leave:function(a){a.bubbles=!1,this.fireEvent("pointerleave",a)},over:function(a){a.bubbles=!0,this.fireEvent("pointerover",a)},out:function(a){a.bubbles=!0,this.fireEvent("pointerout",a)},cancel:function(a){a.bubbles=!0,this.fireEvent("pointercancel",a)},leaveOut:function(a){this.out(a),this.contains(a.target,a.relatedTarget)||this.leave(a)},enterOver:function(a){this.over(a),this.contains(a.target,a.relatedTarget)||this.enter(a)},eventHandler:function(a){if(!a._handledByPE){var b=a.type,c=this.eventMap&&this.eventMap[b];c&&c(a),a._handledByPE=!0}},listen:function(a,b){b.forEach(function(b){this.addEvent(a,b)},this)},unlisten:function(a,b){b.forEach(function(b){this.removeEvent(a,b)},this)},addEvent:function(a,b){a.addEventListener(b,this.boundHandler)},removeEvent:function(a,b){a.removeEventListener(b,this.boundHandler)},makeEvent:function(a,b){this.captureInfo[b.pointerId]&&(b.relatedTarget=null);var c=new m(a,b);return b.preventDefault&&(c.preventDefault=b.preventDefault),c._target=c._target||b.target,c},fireEvent:function(a,b){var c=this.makeEvent(a,b);return this.dispatchEvent(c)},cloneEvent:function(a){for(var b,c=Object.create(null),d=0;d<q.length;d++)b=q[d],c[b]=a[b]||r[d],!t||"target"!==b&&"relatedTarget"!==b||c[b]instanceof SVGElementInstance&&(c[b]=c[b].correspondingUseElement);return a.preventDefault&&(c.preventDefault=function(){a.preventDefault()}),c},getTarget:function(a){var b=this.captureInfo[a.pointerId];return b?a._target!==b&&a.type in s?void 0:b:a._target},setCapture:function(a,b){this.captureInfo[a]&&this.releaseCapture(a),this.captureInfo[a]=b;var c=document.createEvent("Event");c.initEvent("gotpointercapture",!0,!1),c.pointerId=a,this.implicitRelease=this.releaseCapture.bind(this,a),document.addEventListener("pointerup",this.implicitRelease),document.addEventListener("pointercancel",this.implicitRelease),c._target=b,this.asyncDispatchEvent(c)},releaseCapture:function(a){var b=this.captureInfo[a];if(b){var c=document.createEvent("Event");c.initEvent("lostpointercapture",!0,!1),c.pointerId=a,this.captureInfo[a]=void 0,document.removeEventListener("pointerup",this.implicitRelease),document.removeEventListener("pointercancel",this.implicitRelease),c._target=b,this.asyncDispatchEvent(c)}},dispatchEvent:function(a){var b=this.getTarget(a);return b?b.dispatchEvent(a):void 0},asyncDispatchEvent:function(a){requestAnimationFrame(this.dispatchEvent.bind(this,a))}};u.boundHandler=u.eventHandler.bind(u);var v=u,w={shadow:function(a){return a?a.shadowRoot||a.webkitShadowRoot:void 0},canTarget:function(a){return a&&Boolean(a.elementFromPoint)},targetingShadow:function(a){var b=this.shadow(a);return this.canTarget(b)?b:void 0},olderShadow:function(a){var b=a.olderShadowRoot;if(!b){var c=a.querySelector("shadow");c&&(b=c.olderShadowRoot)}return b},allShadows:function(a){for(var b=[],c=this.shadow(a);c;)b.push(c),c=this.olderShadow(c);return b},searchRoot:function(a,b,c){if(a){var d,e,f=a.elementFromPoint(b,c);for(e=this.targetingShadow(f);e;){if(d=e.elementFromPoint(b,c)){var g=this.targetingShadow(d);return this.searchRoot(g,b,c)||d}e=this.olderShadow(e)}return f}},owner:function(a){for(var b=a;b.parentNode;)b=b.parentNode;return b.nodeType!==Node.DOCUMENT_NODE&&b.nodeType!==Node.DOCUMENT_FRAGMENT_NODE&&(b=document),b},findTarget:function(a){var b=a.clientX,c=a.clientY,d=this.owner(a.target);return d.elementFromPoint(b,c)||(d=document),this.searchRoot(d,b,c)}},x=Array.prototype.forEach.call.bind(Array.prototype.forEach),y=Array.prototype.map.call.bind(Array.prototype.map),z=Array.prototype.slice.call.bind(Array.prototype.slice),A=Array.prototype.filter.call.bind(Array.prototype.filter),B=window.MutationObserver||window.WebKitMutationObserver,C="[touch-action]",D={subtree:!0,childList:!0,attributes:!0,attributeOldValue:!0,attributeFilter:["touch-action"]};c.prototype={watchSubtree:function(a){this.observer&&w.canTarget(a)&&this.observer.observe(a,D)},enableOnSubtree:function(a){this.watchSubtree(a),a===document&&"complete"!==document.readyState?this.installOnLoad():this.installNewSubtree(a)},installNewSubtree:function(a){x(this.findElements(a),this.addElement,this)},findElements:function(a){return a.querySelectorAll?a.querySelectorAll(C):[]},removeElement:function(a){this.removeCallback(a)},addElement:function(a){this.addCallback(a)},elementChanged:function(a,b){this.changedCallback(a,b)},concatLists:function(a,b){return a.concat(z(b))},installOnLoad:function(){document.addEventListener("readystatechange",function(){"complete"===document.readyState&&this.installNewSubtree(document)}.bind(this))},isElement:function(a){return a.nodeType===Node.ELEMENT_NODE},flattenMutationTree:function(a){var b=y(a,this.findElements,this);return b.push(A(a,this.isElement)),b.reduce(this.concatLists,[])},mutationWatcher:function(a){a.forEach(this.mutationHandler,this)},mutationHandler:function(a){if("childList"===a.type){var b=this.flattenMutationTree(a.addedNodes);b.forEach(this.addElement,this);var c=this.flattenMutationTree(a.removedNodes);c.forEach(this.removeElement,this)}else"attributes"===a.type&&this.elementChanged(a.target,a.oldValue)}};var E=c,F=["none","auto","pan-x","pan-y",{rule:"pan-x pan-y",selectors:["pan-x pan-y","pan-y pan-x"]}],G="",H=window.PointerEvent||window.MSPointerEvent,I=!window.ShadowDOMPolyfill&&document.head.createShadowRoot,J=v.pointermap,K=25,L=[1,4,2,8,16],M=!1;try{M=1===new MouseEvent("test",{buttons:1}).buttons}catch(N){}var O,P={POINTER_ID:1,POINTER_TYPE:"mouse",events:["mousedown","mousemove","mouseup","mouseover","mouseout"],register:function(a){v.listen(a,this.events)},unregister:function(a){v.unlisten(a,this.events)},lastTouches:[],isEventSimulatedFromTouch:function(a){for(var b,c=this.lastTouches,d=a.clientX,e=a.clientY,f=0,g=c.length;g>f&&(b=c[f]);f++){var h=Math.abs(d-b.x),i=Math.abs(e-b.y);if(K>=h&&K>=i)return!0}},prepareEvent:function(a){var b=v.cloneEvent(a),c=b.preventDefault;return b.preventDefault=function(){a.preventDefault(),c()},b.pointerId=this.POINTER_ID,b.isPrimary=!0,b.pointerType=this.POINTER_TYPE,b},prepareButtonsForMove:function(a,b){var c=J.get(this.POINTER_ID);a.buttons=c?c.buttons:0,b.buttons=a.buttons},mousedown:function(a){if(!this.isEventSimulatedFromTouch(a)){var b=J.get(this.POINTER_ID),c=this.prepareEvent(a);M||(c.buttons=L[c.button],b&&(c.buttons|=b.buttons),a.buttons=c.buttons),J.set(this.POINTER_ID,a),b?v.move(c):v.down(c)}},mousemove:function(a){if(!this.isEventSimulatedFromTouch(a)){var b=this.prepareEvent(a);M||this.prepareButtonsForMove(b,a),v.move(b)}},mouseup:function(a){if(!this.isEventSimulatedFromTouch(a)){var b=J.get(this.POINTER_ID),c=this.prepareEvent(a);if(!M){var d=L[c.button];c.buttons=b?b.buttons&~d:0,a.buttons=c.buttons}J.set(this.POINTER_ID,a),0===c.buttons||c.buttons===L[c.button]?(this.cleanupMouse(),v.up(c)):v.move(c)}},mouseover:function(a){if(!this.isEventSimulatedFromTouch(a)){var b=this.prepareEvent(a);M||this.prepareButtonsForMove(b,a),v.enterOver(b)}},mouseout:function(a){if(!this.isEventSimulatedFromTouch(a)){var b=this.prepareEvent(a);M||this.prepareButtonsForMove(b,a),v.leaveOut(b)}},cancel:function(a){var b=this.prepareEvent(a);v.cancel(b),this.cleanupMouse()},cleanupMouse:function(){J["delete"](this.POINTER_ID)}},Q=P,R=v.captureInfo,S=w.findTarget.bind(w),T=w.allShadows.bind(w),U=v.pointermap,V=2500,W=200,X="touch-action",Y=!1,Z={events:["touchstart","touchmove","touchend","touchcancel"],register:function(a){Y?v.listen(a,this.events):O.enableOnSubtree(a)},unregister:function(a){Y&&v.unlisten(a,this.events)},elementAdded:function(a){var b=a.getAttribute(X),c=this.touchActionToScrollType(b);c&&(a._scrollType=c,v.listen(a,this.events),T(a).forEach(function(a){a._scrollType=c,v.listen(a,this.events)},this))},elementRemoved:function(a){a._scrollType=void 0,v.unlisten(a,this.events),T(a).forEach(function(a){a._scrollType=void 0,v.unlisten(a,this.events)},this)},elementChanged:function(a,b){var c=a.getAttribute(X),d=this.touchActionToScrollType(c),e=this.touchActionToScrollType(b);d&&e?(a._scrollType=d,T(a).forEach(function(a){a._scrollType=d},this)):e?this.elementRemoved(a):d&&this.elementAdded(a)},scrollTypes:{EMITTER:"none",XSCROLLER:"pan-x",YSCROLLER:"pan-y",SCROLLER:/^(?:pan-x pan-y)|(?:pan-y pan-x)|auto$/},touchActionToScrollType:function(a){var b=a,c=this.scrollTypes;return"none"===b?"none":b===c.XSCROLLER?"X":b===c.YSCROLLER?"Y":c.SCROLLER.exec(b)?"XY":void 0},POINTER_TYPE:"touch",firstTouch:null,isPrimaryTouch:function(a){return this.firstTouch===a.identifier},setPrimaryTouch:function(a){(0===U.size||1===U.size&&U.has(1))&&(this.firstTouch=a.identifier,this.firstXY={X:a.clientX,Y:a.clientY},this.scrolling=!1,this.cancelResetClickCount())},removePrimaryPointer:function(a){a.isPrimary&&(this.firstTouch=null,this.firstXY=null,this.resetClickCount())},clickCount:0,resetId:null,resetClickCount:function(){var a=function(){this.clickCount=0,this.resetId=null}.bind(this);this.resetId=setTimeout(a,W)},cancelResetClickCount:function(){this.resetId&&clearTimeout(this.resetId)},typeToButtons:function(a){var b=0;return("touchstart"===a||"touchmove"===a)&&(b=1),b},touchToPointer:function(a){var b=this.currentTouchEvent,c=v.cloneEvent(a),d=c.pointerId=a.identifier+2;c.target=R[d]||S(c),c.bubbles=!0,c.cancelable=!0,c.detail=this.clickCount,c.button=0,c.buttons=this.typeToButtons(b.type),c.width=a.radiusX||a.webkitRadiusX||0,c.height=a.radiusY||a.webkitRadiusY||0,c.pressure=a.force||a.webkitForce||.5,c.isPrimary=this.isPrimaryTouch(a),c.pointerType=this.POINTER_TYPE;var e=this;return c.preventDefault=function(){e.scrolling=!1,e.firstXY=null,b.preventDefault()},c},processTouches:function(a,b){var c=a.changedTouches;this.currentTouchEvent=a;for(var d,e=0;e<c.length;e++)d=c[e],b.call(this,this.touchToPointer(d))},shouldScroll:function(a){if(this.firstXY){var b,c=a.currentTarget._scrollType;if("none"===c)b=!1;else if("XY"===c)b=!0;else{var d=a.changedTouches[0],e=c,f="Y"===c?"X":"Y",g=Math.abs(d["client"+e]-this.firstXY[e]),h=Math.abs(d["client"+f]-this.firstXY[f]);b=g>=h}return this.firstXY=null,b}},findTouch:function(a,b){for(var c,d=0,e=a.length;e>d&&(c=a[d]);d++)if(c.identifier===b)return!0},vacuumTouches:function(a){var b=a.touches;if(U.size>=b.length){var c=[];U.forEach(function(a,d){if(1!==d&&!this.findTouch(b,d-2)){var e=a.out;c.push(e)}},this),c.forEach(this.cancelOut,this)}},touchstart:function(a){this.vacuumTouches(a),this.setPrimaryTouch(a.changedTouches[0]),this.dedupSynthMouse(a),this.scrolling||(this.clickCount++,this.processTouches(a,this.overDown))},overDown:function(a){U.set(a.pointerId,{target:a.target,out:a,outTarget:a.target}),v.over(a),v.enter(a),v.down(a)},touchmove:function(a){this.scrolling||(this.shouldScroll(a)?(this.scrolling=!0,this.touchcancel(a)):(a.preventDefault(),this.processTouches(a,this.moveOverOut)))},moveOverOut:function(a){var b=a,c=U.get(b.pointerId);if(c){var d=c.out,e=c.outTarget;v.move(b),d&&e!==b.target&&(d.relatedTarget=b.target,b.relatedTarget=e,d.target=e,b.target?(v.leaveOut(d),v.enterOver(b)):(b.target=e,b.relatedTarget=null,this.cancelOut(b))),c.out=b,c.outTarget=b.target}},touchend:function(a){this.dedupSynthMouse(a),this.processTouches(a,this.upOut)},upOut:function(a){this.scrolling||(v.up(a),v.out(a),v.leave(a)),this.cleanUpPointer(a)},touchcancel:function(a){this.processTouches(a,this.cancelOut)},cancelOut:function(a){v.cancel(a),v.out(a),v.leave(a),this.cleanUpPointer(a)},cleanUpPointer:function(a){U["delete"](a.pointerId),this.removePrimaryPointer(a)},dedupSynthMouse:function(a){var b=Q.lastTouches,c=a.changedTouches[0];if(this.isPrimaryTouch(c)){var d={x:c.clientX,y:c.clientY};b.push(d);var e=function(a,b){var c=a.indexOf(b);c>-1&&a.splice(c,1)}.bind(null,b,d);setTimeout(e,V)}}};Y||(O=new E(Z.elementAdded,Z.elementRemoved,Z.elementChanged,Z));var $,_,aa=Z,ba=v.pointermap,ca=window.MSPointerEvent&&"number"==typeof window.MSPointerEvent.MSPOINTER_TYPE_MOUSE,da={events:["MSPointerDown","MSPointerMove","MSPointerUp","MSPointerOut","MSPointerOver","MSPointerCancel","MSGotPointerCapture","MSLostPointerCapture"],register:function(a){v.listen(a,this.events)},unregister:function(a){v.unlisten(a,this.events)},POINTER_TYPES:["","unavailable","touch","pen","mouse"],prepareEvent:function(a){var b=a;return ca&&(b=v.cloneEvent(a),b.pointerType=this.POINTER_TYPES[a.pointerType]),b},cleanup:function(a){ba["delete"](a)},MSPointerDown:function(a){ba.set(a.pointerId,a);var b=this.prepareEvent(a);v.down(b)},MSPointerMove:function(a){var b=this.prepareEvent(a);v.move(b)},MSPointerUp:function(a){var b=this.prepareEvent(a);v.up(b),this.cleanup(a.pointerId)},MSPointerOut:function(a){var b=this.prepareEvent(a);v.leaveOut(b)},MSPointerOver:function(a){var b=this.prepareEvent(a);v.enterOver(b)},MSPointerCancel:function(a){var b=this.prepareEvent(a);v.cancel(b),this.cleanup(a.pointerId)},MSLostPointerCapture:function(a){var b=v.makeEvent("lostpointercapture",a);v.dispatchEvent(b)},MSGotPointerCapture:function(a){var b=v.makeEvent("gotpointercapture",a);v.dispatchEvent(b)}},ea=da,fa=window.navigator;fa.msPointerEnabled?($=function(a){i(a),this.msSetPointerCapture(a)},_=function(a){i(a),this.msReleasePointerCapture(a)}):($=function(a){i(a),v.setCapture(a,this)},_=function(a){i(a),v.releaseCapture(a,this)}),g(),h(),j();var ga={dispatcher:v,Installer:E,PointerEvent:m,PointerMap:p,targetFinding:w};return ga});
/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


/**
 * Various functions for touch input.
 *
 * @module Touch
 */
define(
  'misc/touch',[ '../../3rdparty/pep.min',
    './input',
    './misc',
  ], function(pep, Input, Misc) {

  /**
   * @typedef {Object} PadInfo
   * @property {HTMLElement} referenceElement element that is reference for position of pad
   * @property {number} offsetX offset from left of reference element to center of pad
   * @property {number} offsetY offset from top of reference element to center of pad
   * @memberOf module:Touch
   */

  /**
   * @typedef {Object} TouchDPad~Options
   * @property {HTMLElement} inputElement element used to capture input (for example window, body,)
   * @property {callback} callback callback to pass event
   * @property {boolean?} fixedCenter true = center stays the same place, false = each time finger touches a new center is picked
   * @property {number?} deadSpaceRadius size of dead area in center of pad.
   * @property {number?} axisSize use axis.
   * @property {module:Touch~PadInfo[]} pads array of PadInfos, one for each DPad
   * @memberOf module:Touch
   */

  /**
   * Simulates N virtual dpads using touch events
   *
   * For each change in direction callback will be
   * called with an event info where
   *
   *     pad = (index of pad)
   *     direction =
   *
   *
   *        2     -1 = no touch
   *      3 | 1
   *       \|/
   *     4--+--0
   *       /|\
   *      5 | 7
   *        6
   *
   *     dx   = -1, 0, 1
   *     dy   = -1, 0, 1
   *     bits = 1 for right, 2 for left, 4 for up, 8 for down
   *
   * Note: this matches trig functions so you can do this
   *
   *     if (dir >= 0) {
   *       var angle = dir * Math.PI / 4;
   *       var dx    = Math.cos(angle);
   *       var dy    = Math.sin(angle);
   *     }
   *
   * for +y up (ie, normal for 3d)
   *
   * In 2d you'd probably want to flip dy
   *
   *     if (dir >= 0) {
   *       var angle =  dir * Math.PI / 4;
   *       var dx    =  Math.cos(angle);
   *       var dy    = -Math.sin(angle);
   *     }
   *
   * The default way of figuring out the direction is to take the angle from the center to
   * the place of touch, compute an angle, divide a circle into octants, which ever octant is the direction
   *
   * If axisSize is passed in then instead the space is divided into 3x3 boxes. Which ever box the finger is
   * in is the direction. axisSize determines the width height of the axis boxes
   *
   *          | ax |
   *          | is |
   *     -----+----+-----
   *          |    | axis
   *     -----+----+-----
   *          |    |
   *          |    |
   *
   * if `divisions: 4` is passed in then instead of getting 8 directions decided
   * by octant you get 4 decided by quadrant as in
   *
   *            2
   *         \  |  /
   *          \ | /
   *     4 <---   ---> 0
   *          / | \
   *         /  V  \
   *            6
   *
   * @param {module:Touch.TouchDPad~Options} options
   * @memberOf module:Touch
   */

  var setupVirtualDPads = function(options) {
    var callback = options.callback;
    var container = options.inputElement;
    options.deadSpaceRadius = options.deadSpaceRadius || 10;
    var deadSpaceRadiusSq = options.deadSpaceRadius * options.deadSpaceRadius;

    var Vector2 = function(x, y) {
      this.reset(x, y);
    };

    Vector2.prototype.reset = function(x, y) {
      this.x = x;
      this.y = y;
      return this;
    };

    Vector2.prototype.copyFrom = function(src) {
      this.x = src.x;
      this.y = src.y;
    };

    Vector2.prototype.minusEq = function(v) {
      this.x -= v.x;
      this.y -= v.y;
      return this;
    };

    var makePad = function(padId) {
      return {
        pointerId: -1,                      // touch id
        pointerPos: new Vector2(0, 0),      // current position
        pointerStartPos: new Vector2(0, 0), // position when first touched
        vector: new Vector2(0, 0),          // vector from start to current position
        dir: -1,                            // octant
        lastDir: 0,                         // previous octant
        event: Input.createDirectionEventInfo(padId),
      };
    };

    var pads = [];
    for (var ii = 0; ii < options.pads.length; ++ii) {
      pads.push(makePad(ii));
    }

    var computeDirByAngle = function(x, y) {
      var angle = Math.atan2(-y, x) + Math.PI * 2 + Math.PI / 8;
      return (Math.floor(angle / (Math.PI / 4))) % 8;
    };

    var computeDirByAngle4 = function(x, y) {
      if (Math.abs(x) < Math.abs(y)) {
        return y < 0 ? 2 : 6;
      } else {
        return x < 0 ? 4 : 0;
      }
    };

    //      |   |
    //      | V |x
    // -----+---+-----
    //  H   |HV |x H
    // -----+---+-----
    //  y   | Vy|xy
    //      |   |

    var axisBitsToDir = [
       3, // 0
       4, // 1   h
       2, // 2    v
      -1, // 3   hv
       1, // 4     x
       0, // 5   h x
       2, // 6    vx
      -1, // 7   hvx
       5, // 8      y
       4, // 9   h  y
       6, // 10   v y
      -1, // 11  hv y
       7, // 12    xy
       0, // 13  h xy
       6, // 14   vxy
      -1, // 15  hvxy
    ];

    var computeDirByAxis = function(x, y) {
      var h = (Math.abs(y) < options.axisSize / 2) ? 1 : 0;
      var v = (Math.abs(x) < options.axisSize / 2) ? 2 : 0;
      var bits = h | v |
          (x > 0 ? 4 : 0) |
          (y > 0 ? 8 : 0);
      return axisBitsToDir[bits];
    };

    var computeDir = options.axisSize ? computeDirByAxis : computeDirByAngle;

    if (options.divisions === 4) {
      computeDir = computeDirByAngle4;
    }

    var callCallback = function(padId, dir) {
      var pad = pads[padId];
      Input.emitDirectionEvent(padId, dir, pad.event, callback);
    };

    var updatePad = function(pad, padId, out) {
      var newDir = -1;
      if (!out && pad.pointerId >= 0) {
        var distSq = pad.vector.x * pad.vector.x + pad.vector.y * pad.vector.y;
        if (distSq > deadSpaceRadiusSq) {
          newDir = computeDir(pad.vector.x, pad.vector.y);
          pad.lastDir = newDir;
        }
      }
      if (pad.dir !== newDir) {
        pad.dir = newDir;
        callCallback(padId, newDir);
      }
    };

    var checkStart = function(padId, e) {
      var pad = pads[padId];
      var padOptions = options.pads[padId];
      pad.pointerId = e.pointerId;
      var relPos = Input.getRelativeCoordinates(padOptions.referenceElement, e);
      var x = relPos.x - (padOptions.offsetX || padOptions.referenceElement.clientWidth  / 2);
      var y = relPos.y - (padOptions.offsetY || padOptions.referenceElement.clientHeight / 2);
      if (options.fixedCenter) {
        pad.pointerStartPos.reset(0, 0);
        pad.pointerPos.reset(x, y);
        pad.vector.reset(x, y);
        updatePad(pad, padId);
      } else {
        pad.pointerStartPos.reset(x, y);
        pad.pointerPos.copyFrom(pad.pointerStartPos);
        pad.vector.reset(0, 0);
        pad.dir = pad.lastDir;
        callCallback(padId, pad.lastDir);
      }
    };

    var getClosestPad = function(e) {
      var closestId = 0;
      var closestDist;
      for (var ii = 0; ii < pads.length; ++ii) {
        var padOptions = options.pads[ii];
        var refElement = padOptions.referenceElement;
        var relPos = Input.getRelativeCoordinates(refElement, e);
        var centerX = refElement.clientWidth / 2;
        var centerY = refElement.clientHeight / 2;
        var dx = relPos.x - centerX;
        var dy = relPos.y - centerY;
        var distSq = dx * dx + dy * dy;
        if (closestDist === undefined || distSq < closestDist) {
          closestDist = distSq;
          closestId = ii;
        }
      }
      return closestId;
    };

    var onPointerDown = function(e) {
      var padId = getClosestPad(e);
      checkStart(padId, e);
    };

    var onPointerMove = function(e) {
      for (var ii = 0; ii < pads.length; ++ii) {
        var pad = pads[ii];
        if (pad.pointerId === e.pointerId) {
          var padOptions = options.pads[ii];
          var relPos = Input.getRelativeCoordinates(padOptions.referenceElement, e);
          var x = relPos.x - (padOptions.offsetX || padOptions.referenceElement.clientWidth / 2);
          var y = relPos.y - (padOptions.offsetY || padOptions.referenceElement.clientHeight / 2);
          pad.pointerPos.reset(x, y);
          pad.vector.copyFrom(pad.pointerPos);
          pad.vector.minusEq(pad.pointerStartPos);
          updatePad(pad, ii);
        }
      }
    };

    var onPointerUp = function(e) {
      for (var ii = 0; ii < pads.length; ++ii) {
        var pad = pads[ii];
        if (pad.pointerId === e.pointerId) {
          pad.pointerId = -1;
          pad.vector.reset(0, 0);
          updatePad(pad, ii);
        }
      }
    };

    var onPointerOut = function(e) {
      for (var ii = 0; ii < pads.length; ++ii) {
        var pad = pads[ii];
        if (pad.pointerId === e.pointerId) {
          updatePad(pad, ii, true);
        }
      }
    };

    container.addEventListener('pointerdown', onPointerDown, false);
    container.addEventListener('pointermove', onPointerMove, false);
    container.addEventListener('pointerup', onPointerUp, false);
    container.addEventListener('pointerout', onPointerOut, false);
  };

  /**
   * @typedef {Object} ButtonInfo
   * @property {HTMLElement} element element that represents area of buttton (need not be visible)
   * @property {callback} callback function to call when button is pressed or released
   * @memberOf module:Touch
   */

  /**
   * @typedef {Object} Buttons~Options
   * @property {HTMLElement} inputElement element that receives all input. Should be above all buttons
   * @memberOf module:Touch
   */

  /**
   * Sets up touch buttons.
   *
   * For example
   *
   *     var $ = document.getElementById.bind(document);
   *
   *     Touch.setupButtons({
   *       inputElement: $("buttons"),
   *       buttons: [
   *         { element: $("abuttoninput"), callback: handleAbutton, },
   *         { element: $("avatarinput"),  callback: handleShow, },
   *       ],
   *     });
   *
   * The code above sets up 2 buttons. The HTML elements "abuttoninput" and "avatarinput".
   * The actual touch input events come from an HTML element "buttons" which is an div
   * that covers the entire display.
   *
   * @param {module:Touch.Buttons~Options} options
   * @memberOf module:Touch
   */
  var setupButtons = function(options) {
    var buttonInfos = [];
    var buttons = options.buttons;
    //var expirationTime = 2000;  // 2 seconds, 2000ms

    // I don't really know what to make this number
    // If the person has steady hands they can make
    // this fail but I'm going to assume most players
    // most of the time won't hold steady for this long.
    // On the other hand if the button does get stuck
    // It will take this long to un-stick.

    for (var ii = 0; ii < buttons.length; ++ii) {
      var button = buttons[ii];
      var buttonInfo = {
        pointerIds: {},   // Pointers currently in this button
        numPointerIds: 0, // Number of pointers in this button
      };
      Misc.copyProperties(button, buttonInfo);
      buttonInfos.push(buttonInfo);
    }

    // var printButtonInfo = function(buttonInfo) {
    //   console.log("button: " + buttonInfo.element.id + ", " + buttonInfo.numPointerIds);
    // };

    var addPointerId = function(buttonInfo, pointerId, timeStamp) {
      if (!buttonInfo.pointerIds[pointerId]) {
        buttonInfo.pointerIds[pointerId] = timeStamp;
        ++buttonInfo.numPointerIds;
        buttonInfo.callback({pressed: true});
      }
    };

    var removePointerId = function(buttonInfo, pointerId) {
      if (buttonInfo.pointerIds[pointerId]) {
        delete buttonInfo.pointerIds[pointerId];
        --buttonInfo.numPointerIds;
        if (buttonInfo.numPointerIds === 0) {
          buttonInfo.callback({pressed: false});
        } else if (buttonInfo.numPointerIds < 0) {
          throw ("numPointerIds went negative: how did I get here!?");
        }
      }
    };

    // This is because (maybe because my programming sucks?)
    // sometimes it seems we miss an out/up event and buttons
    // get stuck. So, for a particlar id, if no event has come in
    // for a while assume it was released.
    //var expireOldButtons = function() {
    //  var now = Date.now();
    //  buttonInfos.forEach(function(buttonInfo) {
    //    Object.keys(buttonInfo.pointerIds).forEach(function(pointerId) {
    //      var timeStamp = buttonInfo.pointerIds[pointerId];
    //      var age = now - timeStamp;
    //      if (age > expirationTime) {
    //        removePointerId(buttonInfo, pointerId);
    //      }
    //    });
    //  });
    //};

    var handleButtonDown = function(e, buttonInfo) {
      addPointerId(buttonInfo, e.pointerId, e.timeStamp);
    };

    var handleButtonUp = function(e, buttonInfo) {
      removePointerId(buttonInfo, e.pointerId, e.timeStamp);
    };

    var handleButtonMove = function(/*e, buttonInfo*/) {
//      addPointerId(buttonInfo, e.pointerId, e.timeStamp);
    };

    var handleButtonOut = function(e, buttonInfo) {
      removePointerId(buttonInfo, e.pointerId, e.timeStamp);
    };

    var handleButtonEnter = function(e, buttonInfo) {
      addPointerId(buttonInfo, e.pointerId, e.timeStamp);
    };

    var handleButtonLeave = function(e, buttonInfo) {
      removePointerId(buttonInfo, e.pointerId, e.timeStamp);
    };

    var handleButtonCancel = function(e, buttonInfo) {
      removePointerId(buttonInfo, e.pointerId, e.timeStamp);
    };

    var funcs = {
      pointerdown: handleButtonDown,
      pointermove: handleButtonMove,
      pointerup: handleButtonUp,
      pointerout: handleButtonOut,
      pointerenter: handleButtonEnter,
      pointerleave: handleButtonLeave,
      pointercancel: handleButtonCancel,
    };

    buttonInfos.forEach(function(buttonInfo) {
      var elem = buttonInfo.element;
      Object.keys(funcs).forEach(function(eventName) {
        var func = funcs[eventName];
        elem.addEventListener(eventName, function(buttonInfo) {
          return function(e) {
            func(e, buttonInfo);
          };
        }(buttonInfo));
      });
    });

//    setInterval(expireOldButtons, 100);
  };

  return {
    setupVirtualDPads: setupVirtualDPads,
    setupButtons: setupButtons,
  };
});



/*
chroma.js - JavaScript library for color conversions

Copyright (c) 2011-2013, Gregor Aisch
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. The name Gregor Aisch may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL GREGOR AISCH OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/
(function(){var a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,A,B,C,D,E,F,G,H,I,J,K,L,M,N;j=function(b,c,d,e){return new a(b,c,d,e)},"undefined"!=typeof module&&null!==module&&null!=module.exports&&(module.exports=j),"function"==typeof define&&define.amd?define('../3rdparty/chroma.min',[],function(){return j}):(J="undefined"!=typeof exports&&null!==exports?exports:this,J.chroma=j),j.color=function(b,c,d,e){return new a(b,c,d,e)},j.hsl=function(b,c,d,e){return new a(b,c,d,e,"hsl")},j.hsv=function(b,c,d,e){return new a(b,c,d,e,"hsv")},j.rgb=function(b,c,d,e){return new a(b,c,d,e,"rgb")},j.hex=function(b){return new a(b)},j.css=function(b){return new a(b)},j.lab=function(b,c,d){return new a(b,c,d,"lab")},j.lch=function(b,c,d){return new a(b,c,d,"lch")},j.hsi=function(b,c,d){return new a(b,c,d,"hsi")},j.gl=function(b,c,d,e){return new a(b,c,d,e,"gl")},j.num=function(b){return new a(b,"num")},j.random=function(){var b,c,d,e;for(c="0123456789abcdef",b="#",d=e=0;6>e;d=++e)b+=c.charAt(Math.floor(16*Math.random()));return new a(b)},j.interpolate=function(b,c,d,e){var f,g;return null==b||null==c?"#000":(("string"===(f=K(b))||"number"===f)&&(b=new a(b)),("string"===(g=K(c))||"number"===g)&&(c=new a(c)),b.interpolate(d,c,e))},j.mix=j.interpolate,j.contrast=function(b,c){var d,e,f,g;return("string"===(f=K(b))||"number"===f)&&(b=new a(b)),("string"===(g=K(c))||"number"===g)&&(c=new a(c)),d=b.luminance(),e=c.luminance(),d>e?(d+.05)/(e+.05):(e+.05)/(d+.05)},j.luminance=function(a){return j(a).luminance()},j._Color=a,a=function(){function a(){var a,b,c,d,e,f,g,h,i,j,l,m,n,s,u,v;for(f=this,c=[],h=0,d=arguments.length;d>h;h++)b=arguments[h],null!=b&&c.push(b);if(0===c.length)i=[255,0,255,1,"rgb"],s=i[0],u=i[1],v=i[2],a=i[3],e=i[4];else if("array"===K(c[0])){if(3===c[0].length)j=c[0],s=j[0],u=j[1],v=j[2],a=1;else{if(4!==c[0].length)throw"unknown input argument";l=c[0],s=l[0],u=l[1],v=l[2],a=l[3]}e=null!=(m=c[1])?m:"rgb"}else"string"===K(c[0])?(s=c[0],e="hex"):"object"===K(c[0])?(n=c[0]._rgb,s=n[0],u=n[1],v=n[2],a=n[3],e="rgb"):c.length<=2&&"number"===K(c[0])?(s=c[0],e="num"):c.length>=3&&(s=c[0],u=c[1],v=c[2]);3===c.length?(e="rgb",a=1):4===c.length?"string"===K(c[3])?(e=c[3],a=1):"number"===K(c[3])&&(e="rgb",a=c[3]):5===c.length&&(a=c[3],e=c[4]),null==a&&(a=1),"rgb"===e?f._rgb=[s,u,v,a]:"gl"===e?f._rgb=[255*s,255*u,255*v,a]:"hsl"===e?(f._rgb=q(s,u,v),f._rgb[3]=a):"hsv"===e?(f._rgb=r(s,u,v),f._rgb[3]=a):"hex"===e?f._rgb=o(s):"lab"===e?(f._rgb=t(s,u,v),f._rgb[3]=a):"lch"===e?(f._rgb=w(s,u,v),f._rgb[3]=a):"hsi"===e?(f._rgb=p(s,u,v),f._rgb[3]=a):"num"===e&&(f._rgb=A(s)),g=k(f._rgb)}return a.prototype.rgb=function(){return this._rgb.slice(0,3)},a.prototype.rgba=function(){return this._rgb},a.prototype.hex=function(){return B(this._rgb)},a.prototype.toString=function(){return this.name()},a.prototype.hsl=function(){return D(this._rgb)},a.prototype.hsv=function(){return E(this._rgb)},a.prototype.lab=function(){return F(this._rgb)},a.prototype.lch=function(){return G(this._rgb)},a.prototype.hsi=function(){return C(this._rgb)},a.prototype.gl=function(){return[this._rgb[0]/255,this._rgb[1]/255,this._rgb[2]/255,this._rgb[3]]},a.prototype.num=function(){return H(this._rgb)},a.prototype.luminance=function(b,c){var d,e,f,g;return null==c&&(c="rgb"),arguments.length?(0===b&&(this._rgb=[0,0,0,this._rgb[3]]),1===b&&(this._rgb=[255,255,255,this._rgb[3]]),d=y(this._rgb),e=1e-7,f=20,g=function(a,d){var h,i;return i=a.interpolate(.5,d,c),h=i.luminance(),Math.abs(b-h)<e||!f--?i:h>b?g(a,i):g(i,d)},this._rgb=(d>b?g(new a("black"),this):g(this,new a("white"))).rgba(),this):y(this._rgb)},a.prototype.name=function(){var a,b;a=this.hex();for(b in j.colors)if(a===j.colors[b])return b;return a},a.prototype.alpha=function(a){return arguments.length?(this._rgb[3]=a,this):this._rgb[3]},a.prototype.css=function(a){var b,c,d,e;return null==a&&(a="rgb"),c=this,d=c._rgb,3===a.length&&d[3]<1&&(a+="a"),"rgb"===a?a+"("+d.slice(0,3).map(Math.round).join(",")+")":"rgba"===a?a+"("+d.slice(0,3).map(Math.round).join(",")+","+d[3]+")":"hsl"===a||"hsla"===a?(b=c.hsl(),e=function(a){return Math.round(100*a)/100},b[0]=e(b[0]),b[1]=e(100*b[1])+"%",b[2]=e(100*b[2])+"%",4===a.length&&(b[3]=d[3]),a+"("+b.join(",")+")"):void 0},a.prototype.interpolate=function(b,c,d){var e,f,g,h,i,j,k,l,m,n,o,p,q,r;if(l=this,null==d&&(d="rgb"),"string"===K(c)&&(c=new a(c)),"hsl"===d||"hsv"===d||"lch"===d||"hsi"===d)"hsl"===d?(q=l.hsl(),r=c.hsl()):"hsv"===d?(q=l.hsv(),r=c.hsv()):"hsi"===d?(q=l.hsi(),r=c.hsi()):"lch"===d&&(q=l.lch(),r=c.lch()),"h"===d.substr(0,1)?(g=q[0],o=q[1],j=q[2],h=r[0],p=r[1],k=r[2]):(j=q[0],o=q[1],g=q[2],k=r[0],p=r[1],h=r[2]),isNaN(g)||isNaN(h)?isNaN(g)?isNaN(h)?f=Number.NaN:(f=h,1!==j&&0!==j||"hsv"===d||(n=p)):(f=g,1!==k&&0!==k||"hsv"===d||(n=o)):(e=h>g&&h-g>180?h-(g+360):g>h&&g-h>180?h+360-g:h-g,f=g+b*e),null==n&&(n=o+b*(p-o)),i=j+b*(k-j),m="h"===d.substr(0,1)?new a(f,n,i,d):new a(i,n,f,d);else if("rgb"===d)q=l._rgb,r=c._rgb,m=new a(q[0]+b*(r[0]-q[0]),q[1]+b*(r[1]-q[1]),q[2]+b*(r[2]-q[2]),d);else if("num"===d)c instanceof a||(c=new a(c,d)),q=l._rgb,r=c._rgb,m=new a((q[0]+b*(r[0]-q[0])<<16)+(q[1]+b*(r[1]-q[1])<<8)+(q[2]+b*(r[2]-q[2])&255),d);else{if("lab"!==d)throw"color mode "+d+" is not supported";q=l.lab(),r=c.lab(),m=new a(q[0]+b*(r[0]-q[0]),q[1]+b*(r[1]-q[1]),q[2]+b*(r[2]-q[2]),d)}return m.alpha(l.alpha()+b*(c.alpha()-l.alpha())),m},a.prototype.premultiply=function(){var a,b;return b=this.rgb(),a=this.alpha(),j(b[0]*a,b[1]*a,b[2]*a,a)},a.prototype.darken=function(a){var b,c;return null==a&&(a=20),c=this,b=c.lch(),b[0]-=a,j.lch(b).alpha(c.alpha())},a.prototype.darker=function(a){return this.darken(a)},a.prototype.brighten=function(a){return null==a&&(a=20),this.darken(-a)},a.prototype.brighter=function(a){return this.brighten(a)},a.prototype.saturate=function(a){var b,c;return null==a&&(a=20),c=this,b=c.lch(),b[1]+=a,j.lch(b).alpha(c.alpha())},a.prototype.desaturate=function(a){return null==a&&(a=20),this.saturate(-a)},a}(),k=function(a){var b;for(b in a)3>b?(a[b]<0&&(a[b]=0),a[b]>255&&(a[b]=255)):3===b&&(a[b]<0&&(a[b]=0),a[b]>1&&(a[b]=1));return a},n=function(a){var b,c,d,e,f,g,h,i;if(a=a.toLowerCase(),null!=j.colors&&j.colors[a])return o(j.colors[a]);if(f=a.match(/rgb\(\s*(\-?\d+),\s*(\-?\d+)\s*,\s*(\-?\d+)\s*\)/)){for(h=f.slice(1,4),e=g=0;2>=g;e=++g)h[e]=+h[e];h[3]=1}else if(f=a.match(/rgba\(\s*(\-?\d+),\s*(\-?\d+)\s*,\s*(\-?\d+)\s*,\s*([01]|[01]?\.\d+)\)/))for(h=f.slice(1,5),e=i=0;3>=i;e=++i)h[e]=+h[e];else if(f=a.match(/rgb\(\s*(\-?\d+(?:\.\d+)?)%,\s*(\-?\d+(?:\.\d+)?)%\s*,\s*(\-?\d+(?:\.\d+)?)%\s*\)/)){for(h=f.slice(1,4),e=b=0;2>=b;e=++b)h[e]=Math.round(2.55*h[e]);h[3]=1}else if(f=a.match(/rgba\(\s*(\-?\d+(?:\.\d+)?)%,\s*(\-?\d+(?:\.\d+)?)%\s*,\s*(\-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)/)){for(h=f.slice(1,5),e=c=0;2>=c;e=++c)h[e]=Math.round(2.55*h[e]);h[3]=+h[3]}else(f=a.match(/hsl\(\s*(\-?\d+(?:\.\d+)?),\s*(\-?\d+(?:\.\d+)?)%\s*,\s*(\-?\d+(?:\.\d+)?)%\s*\)/))?(d=f.slice(1,4),d[1]*=.01,d[2]*=.01,h=q(d),h[3]=1):(f=a.match(/hsla\(\s*(\-?\d+(?:\.\d+)?),\s*(\-?\d+(?:\.\d+)?)%\s*,\s*(\-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)/))&&(d=f.slice(1,4),d[1]*=.01,d[2]*=.01,h=q(d),h[3]=+f[4]);return h},o=function(a){var b,c,d,e,f,g;if(a.match(/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/))return(4===a.length||7===a.length)&&(a=a.substr(1)),3===a.length&&(a=a.split(""),a=a[0]+a[0]+a[1]+a[1]+a[2]+a[2]),g=parseInt(a,16),e=g>>16,d=g>>8&255,c=255&g,[e,d,c,1];if(a.match(/^#?([A-Fa-f0-9]{8})$/))return 9===a.length&&(a=a.substr(1)),g=parseInt(a,16),e=g>>24&255,d=g>>16&255,c=g>>8&255,b=255&g,[e,d,c,b];if(f=n(a))return f;throw"unknown color: "+a},p=function(a,b,e){var f,g,h,i;return i=L(arguments),a=i[0],b=i[1],e=i[2],a/=360,1/3>a?(f=(1-b)/3,h=(1+b*m(d*a)/m(c-d*a))/3,g=1-(f+h)):2/3>a?(a-=1/3,h=(1-b)/3,g=(1+b*m(d*a)/m(c-d*a))/3,f=1-(h+g)):(a-=2/3,g=(1-b)/3,f=(1+b*m(d*a)/m(c-d*a))/3,h=1-(g+f)),h=x(e*h*3),g=x(e*g*3),f=x(e*f*3),[255*h,255*g,255*f]},q=function(){var a,b,c,d,e,f,g,h,i,j,k,l,m,n;if(i=L(arguments),d=i[0],k=i[1],f=i[2],0===k)h=c=a=255*f;else{for(n=[0,0,0],b=[0,0,0],m=.5>f?f*(1+k):f+k-f*k,l=2*f-m,d/=360,n[0]=d+1/3,n[1]=d,n[2]=d-1/3,e=g=0;2>=g;e=++g)n[e]<0&&(n[e]+=1),n[e]>1&&(n[e]-=1),6*n[e]<1?b[e]=l+6*(m-l)*n[e]:2*n[e]<1?b[e]=m:3*n[e]<2?b[e]=l+(m-l)*(2/3-n[e])*6:b[e]=l;j=[Math.round(255*b[0]),Math.round(255*b[1]),Math.round(255*b[2])],h=j[0],c=j[1],a=j[2]}return[h,c,a]},r=function(){var a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r;if(i=L(arguments),d=i[0],p=i[1],r=i[2],r*=255,0===p)h=c=a=r;else switch(360===d&&(d=0),d>360&&(d-=360),0>d&&(d+=360),d/=60,e=Math.floor(d),b=d-e,f=r*(1-p),g=r*(1-p*b),q=r*(1-p*(1-b)),e){case 0:j=[r,q,f],h=j[0],c=j[1],a=j[2];break;case 1:k=[g,r,f],h=k[0],c=k[1],a=k[2];break;case 2:l=[f,r,q],h=l[0],c=l[1],a=l[2];break;case 3:m=[f,g,r],h=m[0],c=m[1],a=m[2];break;case 4:n=[q,f,r],h=n[0],c=n[1],a=n[2];break;case 5:o=[r,f,g],h=o[0],c=o[1],a=o[2]}return h=Math.round(h),c=Math.round(c),a=Math.round(a),[h,c,a]},b=18,e=.95047,f=1,g=1.08883,s=function(){var a,b,c,d,e,f;return f=L(arguments),e=f[0],a=f[1],b=f[2],c=Math.sqrt(a*a+b*b),d=(Math.atan2(b,a)/Math.PI*180+360)%360,[e,c,d]},t=function(a,b,c){var d,h,i,j,k,l,m;return void 0!==a&&3===a.length&&(i=a,a=i[0],b=i[1],c=i[2]),void 0!==a&&3===a.length&&(j=a,a=j[0],b=j[1],c=j[2]),l=(a+16)/116,k=l+b/500,m=l-c/200,k=u(k)*e,l=u(l)*f,m=u(m)*g,h=N(3.2404542*k-1.5371385*l-.4985314*m),d=N(-.969266*k+1.8760108*l+.041556*m),c=N(.0556434*k-.2040259*l+1.0572252*m),[x(h,0,255),x(d,0,255),x(c,0,255),1]},u=function(a){return a>.206893034?a*a*a:(a-4/29)/7.787037},N=function(a){return Math.round(255*(.00304>=a?12.92*a:1.055*Math.pow(a,1/2.4)-.055))},v=function(){var a,b,c,d;return d=L(arguments),c=d[0],a=d[1],b=d[2],b=b*Math.PI/180,[c,Math.cos(b)*a,Math.sin(b)*a]},w=function(a,b,c){var d,e,f,g,h,i,j;return i=v(a,b,c),d=i[0],e=i[1],f=i[2],j=t(d,e,f),h=j[0],g=j[1],f=j[2],[x(h,0,255),x(g,0,255),x(f,0,255)]},y=function(a,b,c){var d;return d=L(arguments),a=d[0],b=d[1],c=d[2],a=z(a),b=z(b),c=z(c),.2126*a+.7152*b+.0722*c},z=function(a){return a/=255,.03928>=a?a/12.92:Math.pow((a+.055)/1.055,2.4)},A=function(a){var b,c,d;if("number"===K(a)&&a>=0&&16777215>=a)return d=a>>16,c=a>>8&255,b=255&a,[d,c,b,1];throw"unknown num color: "+a},B=function(){var a,b,c,d,e,f;return d=L(arguments),c=d[0],b=d[1],a=d[2],f=c<<16|b<<8|a,e="000000"+f.toString(16),"#"+e.substr(e.length-6)},C=function(){var a,b,c,d,e,f,g,h,i;return h=L(arguments),g=h[0],c=h[1],b=h[2],a=2*Math.PI,g/=255,c/=255,b/=255,f=Math.min(g,c,b),e=(g+c+b)/3,i=1-f/e,0===i?d=0:(d=(g-c+(g-b))/2,d/=Math.sqrt((g-c)*(g-c)+(g-b)*(c-b)),d=Math.acos(d),b>c&&(d=a-d),d/=a),[360*d,i,e]},D=function(a,b,c){var d,e,f,g,h,i;return void 0!==a&&a.length>=3&&(h=a,a=h[0],b=h[1],c=h[2]),a/=255,b/=255,c/=255,g=Math.min(a,b,c),f=Math.max(a,b,c),e=(f+g)/2,f===g?(i=0,d=Number.NaN):i=.5>e?(f-g)/(f+g):(f-g)/(2-f-g),a===f?d=(b-c)/(f-g):b===f?d=2+(c-a)/(f-g):c===f&&(d=4+(a-b)/(f-g)),d*=60,0>d&&(d+=360),[d,i,e]},E=function(){var a,b,c,d,e,f,g,h,i,j;return h=L(arguments),g=h[0],c=h[1],a=h[2],f=Math.min(g,c,a),e=Math.max(g,c,a),b=e-f,j=e/255,0===e?(d=Number.NaN,i=0):(i=b/e,g===e&&(d=(c-a)/b),c===e&&(d=2+(a-g)/b),a===e&&(d=4+(g-c)/b),d*=60,0>d&&(d+=360)),[d,i,j]},F=function(){var a,b,c,d,h,i,j;return d=L(arguments),c=d[0],b=d[1],a=d[2],c=I(c),b=I(b),a=I(a),h=M((.4124564*c+.3575761*b+.1804375*a)/e),i=M((.2126729*c+.7151522*b+.072175*a)/f),j=M((.0193339*c+.119192*b+.9503041*a)/g),[116*i-16,500*(h-i),200*(i-j)]},I=function(a){return(a/=255)<=.04045?a/12.92:Math.pow((a+.055)/1.055,2.4)},M=function(a){return a>.008856?Math.pow(a,1/3):7.787037*a+4/29},G=function(){var a,b,c,d,e,f,g;return f=L(arguments),e=f[0],c=f[1],b=f[2],g=F(e,c,b),d=g[0],a=g[1],b=g[2],s(d,a,b)},H=function(){var a,b,c,d;return d=L(arguments),c=d[0],b=d[1],a=d[2],(c<<16)+(b<<8)+a},j.scale=function(a,b){var c,d,e,f,g,h,i,k,l,m,n,o,p,q,r,s,t,u,v,w,x;return k="rgb",l=j("#ccc"),p=0,g=!1,f=[0,1],d=[],n=!1,o=[],i=0,h=1,e=!1,m=0,c={},v=function(a,b){var c,e,f,g,h,i,k;if(null==a&&(a=["#ddd","#222"]),null!=a&&"string"===K(a)&&null!=(null!=(g=j.brewer)?g[a]:void 0)&&(a=j.brewer[a]),"array"===K(a)){for(a=a.slice(0),c=f=0,h=a.length-1;h>=0?h>=f:f>=h;c=h>=0?++f:--f)e=a[c],"string"===K(e)&&(a[c]=j(e));if(null!=b)o=b;else for(o=[],c=k=0,i=a.length-1;i>=0?i>=k:k>=i;c=i>=0?++k:--k)o.push(c/(a.length-1))}return u(),d=a},w=function(a){return null==a&&(a=[]),f=a,i=a[0],h=a[a.length-1],u(),m=2===a.length?0:a.length-1},s=function(a){var b,c;if(null!=f){for(c=f.length-1,b=0;c>b&&a>=f[b];)b++;return b-1}return 0},x=function(a){return a},q=function(a){var b,c,d,e,g;return g=a,f.length>2&&(e=f.length-1,b=s(a),d=f[0]+(f[1]-f[0])*(0+.5*p),c=f[e-1]+(f[e]-f[e-1])*(1-.5*p),g=i+(f[b]+.5*(f[b+1]-f[b])-d)/(c-d)*(h-i)),g},t=function(a,b){var e,g,n,p,q,r,t,u,v;if(null==b&&(b=!1),isNaN(a))return l;if(b?v=a:f.length>2?(e=s(a),v=e/(m-1)):(v=n=i!==h?(a-i)/(h-i):0,v=n=(a-i)/(h-i),v=Math.min(1,Math.max(0,v))),b||(v=x(v)),q=Math.floor(1e4*v),c[q])g=c[q];else{if("array"===K(d))for(p=r=0,u=o.length-1;u>=0?u>=r:r>=u;p=u>=0?++r:--r){if(t=o[p],t>=v){g=d[p];break}if(v>=t&&p===o.length-1){g=d[p];break}if(v>t&&v<o[p+1]){v=(v-t)/(o[p+1]-t),g=j.interpolate(d[p],d[p+1],v,k);break}}else"function"===K(d)&&(g=d(v));c[q]=g}return g},u=function(){return c={}},v(a,b),r=function(a){var b;return b=t(a),n&&b[n]?b[n]():b},r.domain=function(a,b,c,d){var e;return null==c&&(c="e"),arguments.length?(null!=b&&(e=j.analyze(a,d),a=0===b?[e.min,e.max]:j.limits(e,c,b)),w(a),r):f},r.mode=function(a){return arguments.length?(k=a,u(),r):k},r.range=function(a,b){return v(a,b),r},r.out=function(a){return n=a,r},r.spread=function(a){return arguments.length?(p=a,r):p},r.correctLightness=function(a){return arguments.length?(e=a,u(),x=e?function(a){var b,c,d,e,f,g,h,i,j;for(b=t(0,!0).lab()[0],c=t(1,!0).lab()[0],h=b>c,d=t(a,!0).lab()[0],f=b+(c-b)*a,e=d-f,i=0,j=1,g=20;Math.abs(e)>.01&&g-->0;)!function(){return h&&(e*=-1),0>e?(i=a,a+=.5*(j-a)):(j=a,a+=.5*(i-a)),d=t(a,!0).lab()[0],e=d-f}();return a}:function(a){return a},r):e},r.colors=function(b){var c,d,e,g,h,i;if(null==b&&(b="hex"),a=[],h=[],f.length>2)for(c=e=1,g=f.length;g>=1?g>e:e>g;c=g>=1?++e:--e)h.push(.5*(f[c-1]+f[c]));else h=f;for(i=0,d=h.length;d>i;i++)c=h[i],a.push(r(c)[b]());return a},r},null==j.scales&&(j.scales={}),j.scales.cool=function(){return j.scale([j.hsl(180,1,.9),j.hsl(250,.7,.4)])},j.scales.hot=function(){return j.scale(["#000","#f00","#ff0","#fff"],[0,.25,.75,1]).mode("rgb")},j.analyze=function(a,b,c){var d,e,f,g,h,i,k;if(h={min:Number.MAX_VALUE,max:-1*Number.MAX_VALUE,sum:0,values:[],count:0},null==c&&(c=function(){return!0}),d=function(a){null==a||isNaN(a)||(h.values.push(a),h.sum+=a,a<h.min&&(h.min=a),a>h.max&&(h.max=a),h.count+=1)},k=function(a,e){return c(a,e)?d(null!=b&&"function"===K(b)?b(a):null!=b&&"string"===K(b)||"number"===K(b)?a[b]:a):void 0},"array"===K(a))for(g=0,f=a.length;f>g;g++)i=a[g],k(i);else for(e in a)i=a[e],k(i,e);return h.domain=[h.min,h.max],h.limits=function(a,b){return j.limits(h,a,b)},h},j.limits=function(a,b,c){var d,e,f,g,h,i,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,A,B,C,D,E,F,G,H,I,J,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,$,_,aa,ba,ca,da,ea,fa,ga;if(null==b&&(b="equal"),null==c&&(c=7),"array"===K(a)&&(a=j.analyze(a)),D=a.min,B=a.max,ca=a.sum,fa=a.values.sort(function(a,b){return a-b}),A=[],"c"===b.substr(0,1)&&(A.push(D),A.push(B)),"e"===b.substr(0,1)){for(A.push(D),x=J=1,O=c-1;O>=1?O>=J:J>=O;x=O>=1?++J:--J)A.push(D+x/c*(B-D));A.push(B)}else if("l"===b.substr(0,1)){if(0>=D)throw"Logarithmic scales are only possible for values > 0";for(E=Math.LOG10E*Math.log(D),C=Math.LOG10E*Math.log(B),A.push(D),x=ga=1,P=c-1;P>=1?P>=ga:ga>=P;x=P>=1?++ga:--ga)A.push(Math.pow(10,E+x/c*(C-E)));A.push(B)}else if("q"===b.substr(0,1)){for(A.push(D),x=d=1,V=c-1;V>=1?V>=d:d>=V;x=V>=1?++d:--d)L=fa.length*x/c,M=Math.floor(L),M===L?A.push(fa[M]):(N=L-M,A.push(fa[M]*N+fa[M+1]*(1-N)));A.push(B)}else if("k"===b.substr(0,1)){for(G=fa.length,r=new Array(G),v=new Array(c),ba=!0,H=0,t=null,t=[],t.push(D),x=e=1,W=c-1;W>=1?W>=e:e>=W;x=W>=1?++e:--e)t.push(D+x/c*(B-D));for(t.push(B);ba;){for(y=f=0,X=c-1;X>=0?X>=f:f>=X;y=X>=0?++f:--f)v[y]=0;for(x=g=0,Y=G-1;Y>=0?Y>=g:g>=Y;x=Y>=0?++g:--g){for(ea=fa[x],F=Number.MAX_VALUE,y=h=0,Z=c-1;Z>=0?Z>=h:h>=Z;y=Z>=0?++h:--h)w=Math.abs(t[y]-ea),F>w&&(F=w,s=y);v[s]++,r[x]=s}for(I=new Array(c),y=i=0,$=c-1;$>=0?$>=i:i>=$;y=$>=0?++i:--i)I[y]=null;for(x=k=0,_=G-1;_>=0?_>=k:k>=_;x=_>=0?++k:--k)u=r[x],null===I[u]?I[u]=fa[x]:I[u]+=fa[x];for(y=l=0,aa=c-1;aa>=0?aa>=l:l>=aa;y=aa>=0?++l:--l)I[y]*=1/v[y];for(ba=!1,y=m=0,Q=c-1;Q>=0?Q>=m:m>=Q;y=Q>=0?++m:--m)if(I[y]!==t[x]){ba=!0;break}t=I,H++,H>200&&(ba=!1)}for(z={},y=n=0,R=c-1;R>=0?R>=n:n>=R;y=R>=0?++n:--n)z[y]=[];for(x=o=0,S=G-1;S>=0?S>=o:o>=S;x=S>=0?++o:--o)u=r[x],z[u].push(fa[x]);for(da=[],y=p=0,T=c-1;T>=0?T>=p:p>=T;y=T>=0?++p:--p)da.push(z[y][0]),da.push(z[y][z[y].length-1]);for(da=da.sort(function(a,b){return a-b}),A.push(da[0]),x=q=1,U=da.length-1;U>=q;x=q+=2)isNaN(da[x])||A.push(da[x])}return A},j.brewer=i={OrRd:["#fff7ec","#fee8c8","#fdd49e","#fdbb84","#fc8d59","#ef6548","#d7301f","#b30000","#7f0000"],PuBu:["#fff7fb","#ece7f2","#d0d1e6","#a6bddb","#74a9cf","#3690c0","#0570b0","#045a8d","#023858"],BuPu:["#f7fcfd","#e0ecf4","#bfd3e6","#9ebcda","#8c96c6","#8c6bb1","#88419d","#810f7c","#4d004b"],Oranges:["#fff5eb","#fee6ce","#fdd0a2","#fdae6b","#fd8d3c","#f16913","#d94801","#a63603","#7f2704"],BuGn:["#f7fcfd","#e5f5f9","#ccece6","#99d8c9","#66c2a4","#41ae76","#238b45","#006d2c","#00441b"],YlOrBr:["#ffffe5","#fff7bc","#fee391","#fec44f","#fe9929","#ec7014","#cc4c02","#993404","#662506"],YlGn:["#ffffe5","#f7fcb9","#d9f0a3","#addd8e","#78c679","#41ab5d","#238443","#006837","#004529"],Reds:["#fff5f0","#fee0d2","#fcbba1","#fc9272","#fb6a4a","#ef3b2c","#cb181d","#a50f15","#67000d"],RdPu:["#fff7f3","#fde0dd","#fcc5c0","#fa9fb5","#f768a1","#dd3497","#ae017e","#7a0177","#49006a"],Greens:["#f7fcf5","#e5f5e0","#c7e9c0","#a1d99b","#74c476","#41ab5d","#238b45","#006d2c","#00441b"],YlGnBu:["#ffffd9","#edf8b1","#c7e9b4","#7fcdbb","#41b6c4","#1d91c0","#225ea8","#253494","#081d58"],Purples:["#fcfbfd","#efedf5","#dadaeb","#bcbddc","#9e9ac8","#807dba","#6a51a3","#54278f","#3f007d"],GnBu:["#f7fcf0","#e0f3db","#ccebc5","#a8ddb5","#7bccc4","#4eb3d3","#2b8cbe","#0868ac","#084081"],Greys:["#ffffff","#f0f0f0","#d9d9d9","#bdbdbd","#969696","#737373","#525252","#252525","#000000"],YlOrRd:["#ffffcc","#ffeda0","#fed976","#feb24c","#fd8d3c","#fc4e2a","#e31a1c","#bd0026","#800026"],PuRd:["#f7f4f9","#e7e1ef","#d4b9da","#c994c7","#df65b0","#e7298a","#ce1256","#980043","#67001f"],Blues:["#f7fbff","#deebf7","#c6dbef","#9ecae1","#6baed6","#4292c6","#2171b5","#08519c","#08306b"],PuBuGn:["#fff7fb","#ece2f0","#d0d1e6","#a6bddb","#67a9cf","#3690c0","#02818a","#016c59","#014636"],Spectral:["#9e0142","#d53e4f","#f46d43","#fdae61","#fee08b","#ffffbf","#e6f598","#abdda4","#66c2a5","#3288bd","#5e4fa2"],RdYlGn:["#a50026","#d73027","#f46d43","#fdae61","#fee08b","#ffffbf","#d9ef8b","#a6d96a","#66bd63","#1a9850","#006837"],RdBu:["#67001f","#b2182b","#d6604d","#f4a582","#fddbc7","#f7f7f7","#d1e5f0","#92c5de","#4393c3","#2166ac","#053061"],PiYG:["#8e0152","#c51b7d","#de77ae","#f1b6da","#fde0ef","#f7f7f7","#e6f5d0","#b8e186","#7fbc41","#4d9221","#276419"],PRGn:["#40004b","#762a83","#9970ab","#c2a5cf","#e7d4e8","#f7f7f7","#d9f0d3","#a6dba0","#5aae61","#1b7837","#00441b"],RdYlBu:["#a50026","#d73027","#f46d43","#fdae61","#fee090","#ffffbf","#e0f3f8","#abd9e9","#74add1","#4575b4","#313695"],BrBG:["#543005","#8c510a","#bf812d","#dfc27d","#f6e8c3","#f5f5f5","#c7eae5","#80cdc1","#35978f","#01665e","#003c30"],RdGy:["#67001f","#b2182b","#d6604d","#f4a582","#fddbc7","#ffffff","#e0e0e0","#bababa","#878787","#4d4d4d","#1a1a1a"],PuOr:["#7f3b08","#b35806","#e08214","#fdb863","#fee0b6","#f7f7f7","#d8daeb","#b2abd2","#8073ac","#542788","#2d004b"],Set2:["#66c2a5","#fc8d62","#8da0cb","#e78ac3","#a6d854","#ffd92f","#e5c494","#b3b3b3"],Accent:["#7fc97f","#beaed4","#fdc086","#ffff99","#386cb0","#f0027f","#bf5b17","#666666"],Set1:["#e41a1c","#377eb8","#4daf4a","#984ea3","#ff7f00","#ffff33","#a65628","#f781bf","#999999"],Set3:["#8dd3c7","#ffffb3","#bebada","#fb8072","#80b1d3","#fdb462","#b3de69","#fccde5","#d9d9d9","#bc80bd","#ccebc5","#ffed6f"],Dark2:["#1b9e77","#d95f02","#7570b3","#e7298a","#66a61e","#e6ab02","#a6761d","#666666"],Paired:["#a6cee3","#1f78b4","#b2df8a","#33a02c","#fb9a99","#e31a1c","#fdbf6f","#ff7f00","#cab2d6","#6a3d9a","#ffff99","#b15928"],Pastel2:["#b3e2cd","#fdcdac","#cbd5e8","#f4cae4","#e6f5c9","#fff2ae","#f1e2cc","#cccccc"],Pastel1:["#fbb4ae","#b3cde3","#ccebc5","#decbe4","#fed9a6","#ffffcc","#e5d8bd","#fddaec","#f2f2f2"]},j.colors=l={indigo:"#4b0082",gold:"#ffd700",hotpink:"#ff69b4",firebrick:"#b22222",indianred:"#cd5c5c",yellow:"#ffff00",mistyrose:"#ffe4e1",darkolivegreen:"#556b2f",olive:"#808000",darkseagreen:"#8fbc8f",pink:"#ffc0cb",tomato:"#ff6347",lightcoral:"#f08080",orangered:"#ff4500",navajowhite:"#ffdead",lime:"#00ff00",palegreen:"#98fb98",darkslategrey:"#2f4f4f",greenyellow:"#adff2f",burlywood:"#deb887",seashell:"#fff5ee",mediumspringgreen:"#00fa9a",fuchsia:"#ff00ff",papayawhip:"#ffefd5",blanchedalmond:"#ffebcd",chartreuse:"#7fff00",dimgray:"#696969",black:"#000000",peachpuff:"#ffdab9",springgreen:"#00ff7f",aquamarine:"#7fffd4",white:"#ffffff",orange:"#ffa500",lightsalmon:"#ffa07a",darkslategray:"#2f4f4f",brown:"#a52a2a",ivory:"#fffff0",dodgerblue:"#1e90ff",peru:"#cd853f",lawngreen:"#7cfc00",chocolate:"#d2691e",crimson:"#dc143c",forestgreen:"#228b22",darkgrey:"#a9a9a9",lightseagreen:"#20b2aa",cyan:"#00ffff",mintcream:"#f5fffa",silver:"#c0c0c0",antiquewhite:"#faebd7",mediumorchid:"#ba55d3",skyblue:"#87ceeb",gray:"#808080",darkturquoise:"#00ced1",goldenrod:"#daa520",darkgreen:"#006400",floralwhite:"#fffaf0",darkviolet:"#9400d3",darkgray:"#a9a9a9",moccasin:"#ffe4b5",saddlebrown:"#8b4513",grey:"#808080",darkslateblue:"#483d8b",lightskyblue:"#87cefa",lightpink:"#ffb6c1",mediumvioletred:"#c71585",slategrey:"#708090",red:"#ff0000",deeppink:"#ff1493",limegreen:"#32cd32",darkmagenta:"#8b008b",palegoldenrod:"#eee8aa",plum:"#dda0dd",turquoise:"#40e0d0",lightgrey:"#d3d3d3",lightgoldenrodyellow:"#fafad2",darkgoldenrod:"#b8860b",lavender:"#e6e6fa",maroon:"#800000",yellowgreen:"#9acd32",sandybrown:"#f4a460",thistle:"#d8bfd8",violet:"#ee82ee",navy:"#000080",magenta:"#ff00ff",dimgrey:"#696969",tan:"#d2b48c",rosybrown:"#bc8f8f",olivedrab:"#6b8e23",blue:"#0000ff",lightblue:"#add8e6",ghostwhite:"#f8f8ff",honeydew:"#f0fff0",cornflowerblue:"#6495ed",slateblue:"#6a5acd",linen:"#faf0e6",darkblue:"#00008b",powderblue:"#b0e0e6",seagreen:"#2e8b57",darkkhaki:"#bdb76b",snow:"#fffafa",sienna:"#a0522d",mediumblue:"#0000cd",royalblue:"#4169e1",lightcyan:"#e0ffff",green:"#008000",mediumpurple:"#9370db",midnightblue:"#191970",cornsilk:"#fff8dc",paleturquoise:"#afeeee",bisque:"#ffe4c4",slategray:"#708090",darkcyan:"#008b8b",khaki:"#f0e68c",wheat:"#f5deb3",teal:"#008080",darkorchid:"#9932cc",deepskyblue:"#00bfff",salmon:"#fa8072",darkred:"#8b0000",steelblue:"#4682b4",palevioletred:"#db7093",lightslategray:"#778899",aliceblue:"#f0f8ff",lightslategrey:"#778899",lightgreen:"#90ee90",orchid:"#da70d6",gainsboro:"#dcdcdc",mediumseagreen:"#3cb371",lightgray:"#d3d3d3",mediumturquoise:"#48d1cc",lemonchiffon:"#fffacd",cadetblue:"#5f9ea0",lightyellow:"#ffffe0",lavenderblush:"#fff0f5",coral:"#ff7f50",purple:"#800080",aqua:"#00ffff",whitesmoke:"#f5f5f5",mediumslateblue:"#7b68ee",darkorange:"#ff8c00",mediumaquamarine:"#66cdaa",darksalmon:"#e9967a",beige:"#f5f5dc",blueviolet:"#8a2be2",azure:"#f0ffff",lightsteelblue:"#b0c4de",oldlace:"#fdf5e6"},K=function(){var a,b,c,d,e;for(a={},e="Boolean Number String Function Array Date RegExp Undefined Null".split(" "),d=0,b=e.length;b>d;d++)c=e[d],a["[object "+c+"]"]=c.toLowerCase();return function(b){var c;return c=Object.prototype.toString.call(b),a[c]||"object"}}(),x=function(a,b,c){return null==b&&(b=0),null==c&&(c=1),b>a&&(a=b),a>c&&(a=c),a},L=function(a){return a.length>=3?a:a[0]},d=2*Math.PI,c=Math.PI/3,m=Math.cos,h=function(a){var b,c,d,e,f,g,i,k,l,m,n;return a=function(){var b,c,d;for(d=[],c=0,b=a.length;b>c;c++)e=a[c],d.push(j(e));return d}(),2===a.length?(l=function(){var b,c,d;for(d=[],c=0,b=a.length;b>c;c++)e=a[c],d.push(e.lab());return d}(),f=l[0],g=l[1],b=function(a){var b,c;return c=function(){var c,d;for(d=[],b=c=0;2>=c;b=++c)d.push(f[b]+a*(g[b]-f[b]));return d}(),j.lab.apply(j,c)}):3===a.length?(m=function(){var b,c,d;for(d=[],c=0,b=a.length;b>c;c++)e=a[c],d.push(e.lab());return d}(),f=m[0],g=m[1],i=m[2],b=function(a){var b,c;return c=function(){var c,d;for(d=[],b=c=0;2>=c;b=++c)d.push((1-a)*(1-a)*f[b]+2*(1-a)*a*g[b]+a*a*i[b]);return d}(),j.lab.apply(j,c)}):4===a.length?(n=function(){var b,c,d;for(d=[],c=0,b=a.length;b>c;c++)e=a[c],d.push(e.lab());return d}(),f=n[0],g=n[1],i=n[2],k=n[3],b=function(a){var b,c;return c=function(){var c,d;for(d=[],b=c=0;2>=c;b=++c)d.push((1-a)*(1-a)*(1-a)*f[b]+3*(1-a)*(1-a)*a*g[b]+3*(1-a)*a*a*i[b]+a*a*a*k[b]);return d}(),j.lab.apply(j,c)}):5===a.length&&(c=h(a.slice(0,3)),d=h(a.slice(2,5)),b=function(a){return.5>a?c(2*a):d(2*(a-.5))}),b},j.interpolate.bezier=h}).call(this);
requirejs([
  './commonui',
  './misc/input',
  './misc/misc',
  './misc/mobilehacks',
  './misc/strings',
  './misc/touch',
  '../3rdparty/chroma.min',
], function(
  commonUI,
  input,
  misc,
  mobileHacks,
  strings,
  touch,
  chroma) {
  var location = window.location.host;
  var query = window.location.search;
  var settings = {};
  if (query) {
    query.substr(1).split("&").forEach(function(pair) {
      var keyValue = pair.split("=").map(decodeURIComponent);
      settings[keyValue[0]] = keyValue[1];
    });
    location = settings.location || location;
  }
  var socket = new WebSocket('ws://'+location+'/websocket.lua');
  socket.binaryType = 'arraybuffer';

  //function checkKey(e) {
  //  e = e || window.event;
  //  switch (e.keyCode) {
  //  case 32://space
  //    return 0;
  //  case 39://right
  //    return 1;
  //  case 37://left
  //    return 2;
  //  case 40://down
  //    return 3;
  //  case 38://up
  //    return 4;
  //  case 27://esc
  //    return 5;
  //  default:
  //    return false;
  //  }
  //}
  //
  //var bytearray = new Uint8Array(1);
  //
  //function onkeydown(e) {
  //  var x = checkKey(e);
  //  if (x !== false) {
  //    bytearray[0] = x;
  //    socket.send(bytearray);
  //  }
  //}
  //
  //function onkeyup(e) {
  //  var x = checkKey(e);
  //  if (x !== false) {
  //    bytearray[0] = x | 128;
  //    socket.send(bytearray);
  //  }
  //}
  //
  //document.onkeydown = onkeydown;
  //document.onkeyup = onkeyup;
  var $ = document.getElementById.bind(document);
  var globals = {
    debug: false,
    // orientation: "landscape-primary",
  };
  misc.applyUrlSettings(globals);
  mobileHacks.disableContextMenu();
  mobileHacks.fixHeightHack();
  mobileHacks.adjustCSSBasedOnPhone([
    {
      test: mobileHacks.isIOS8OrNewerAndiPhone4OrIPhone5,
      styles: {
        ".button": {
          bottom: "40%",
        },
      },
    },
  ]);

  var fullElem = $("full");

  var layouts = {
    "1button": {
      orientation: "none",
      buttons: true,
    },
    "2button": {
      orientation: "none",
      buttons: true,
    },
    "1dpad-1button": {
      orientation: "landscape",
      buttons: true,
      dpads: true,
    },
    "1dpad-2button": {
      orientation: "landscape",
      buttons: true,
      dpads: true,
    },
    "1dpad": {
      orientation: "none",
      dpads: true,
    },
    "2dpad": {
      orientation: "landscape",
      dpads: true,
    },
    "1lrpad-1button": {
      orientation: "landscape",
      buttons: true,
      lrpads: true,
    },
    "1lrpad-2button": {
      orientation: "landscape",
      buttons: true,
      lrpads: true,
    },
    "1lrpad": {
      orientation: "none",
      lrpads: true,
    },
    "touch": {
      orientation: "none",
      orientationOptional: true,
    },
  };

  function handleColor(data) {
    // the color arrives in data.color.
    // we use chroma.js to darken the color
    // then we get our style from a template in controller.html
    // sub in our colors, remove extra whitespace and attach to body.
    var subs = {
      light: data.color,
      dark: chroma(data.color).darken().hex(),
    };
    var style = $("background-style").text;
    style = strings.replaceParams(style, subs).replace(/[\n ]+/g, ' ').trim();
    document.body.style.background = style;
  }

  function notLayout(name) {
    return name.substr(0, 7) !== "layout-";
  }

  function handleOptions(data) {
    data = data || {};
    var controllerType = data.controllerType;
    controllerType = (controllerType || "").replace(/s/g, "").toLowerCase();  // remove 's' so buttons -> button, dpads -> dpad
    if (!(controllerType in layouts)) {
      if (controllerType) {
        client.error("unknown controller type: " + controllerType);
        client.error("valid types are:\n" + Object.keys(layouts).join("\n"));
      }
      controllerType = "1dpad-2button";
    }
    var elem = $("buttons");
    var classes = elem.className.split(/[ \t\n]+/);
    classes = classes.filter(notLayout);
    classes.unshift("layout-" + controllerType);
    elem.className = classes.join(" ");

    var layout = layouts[controllerType];
    commonUI.setOrientation(layout.orientation, layout.orientationOptional);
  }

  function handleFull() {
    fullElem.style.display = "block";
  }

  function handlePlay() {
    fullElem.style.display = "none";
  }

  // This way of making buttons probably looks complicated but
  // it lets us easily make more buttons.
  //
  // It's actually pretty simple. We embed 2 svg files
  // in the HTML in a script tag. We could load them but
  // loading is ASYNC
  //
  // We put in substitutions in the form of %(nameOfValue)s
  // so we can easily replace the colors. We could have done
  // that by looking up nodes or using CSS but this was easiest.
  //
  // We then insert that text into a div by id, look up
  // the 2 svg files and hook up some functions, press(), and
  // isPressed() that we can use check the state of the button
  // and to change which svg shows.
  var Button = function() {
    var svgSrc = $("button-img").text + $("button-pressed").text;

    return function Button(id, options) {
      var element = $(id);
      var pressed = false;
      element.innerHTML = strings.replaceParams(svgSrc, options);
      var buttonSvg  = element.querySelector(".button-img");
      var pressedSvg = element.querySelector(".button-pressed");

      this.press = function(press) {
        pressed = press;
        buttonSvg.style.display  =  pressed ? "none" : "inline-block";
        pressedSvg.style.display = !pressed ? "none" : "inline-block";
      };

      this.isPressed = function() {
        return pressed;
      };

      this.press(false);
    };
  }();

  // Make 2 buttons
  var buttons = [
    new Button("buttonA", { surfaceColor: "#F64B83", edgeColor: "#76385E" }),
  ];

  var DPad = function(id) {
    var element = $(id);
    element.innerHTML = $("dpad-image").text;
  };
  // TODO: animate dpads
  var dpads = [  // eslint-disable-line
    new DPad("dpad1"),
  ];

  commonUI.setupStandardControllerUI(socket, globals);

  var disconnectedElement = $("hft-disconnected");
  socket.onerror = handleError;
  socket.onclose = handleError;
  socket.onopen  = function() { connected = true; };

  function handleError() {
    connected = false;
    disconnectedElement.style.display = "block";
  }

  var buttonState = 0;
  var oldButtonState = 0;
  function sendChanges() {
    for (var ii = 0; ii < 6; ++ii) {
      var bit = 1 << ii;
      var oldState = oldButtonState & bit;
      var newState = buttonState & bit;
      if (oldState != newState) {
        sendBit(ii, newState);
      }
    }
    oldButtonState = buttonState;
  }

  var bitMap = [
    1,  // 0 : right
    2,  // 1 : left
    4,  // 2 : up
    3,  // 3 : down
    0,  // 4 : button 1
    5,  // 5 : button 2
  ];
  var bytearray = new Uint8Array(1);
  function sendBit(bit, on) {
    bytearray[0] = bitMap[bit] | (on ? 0x00 : 0x80);
    if (connected) {
      socket.send(bytearray);
    }
  }

  // Since we take input touch, mouse, and keyboard
  // we only send the button to the game when it's state
  // changes.
  function handleButton(pressed, id) {
    var button = buttons[id];
    if (pressed !== button.isPressed()) {
      button.press(pressed);
      var bit = id ? 0x20 : 0x10;
      buttonState = (buttonState & ~bit) | (pressed ? bit : 0);
      sendChanges();
    }
  }

  function handleInvButton(pressed, id) {
    var bit = id ? 0x20 : 0x10;
    buttonState = (buttonState & ~bit) | (pressed ? bit : 0);
    sendChanges();
  }

  function handleDPad(e) {
    // lrpad is just dpad0
    var pad = e.pad;
    var bits = e.info.bits;
    buttonState = (buttonState & 0xFFFFFF0) | bits;
    sendChanges();
  }

  // Setup some keys so we can more easily test on desktop
  var keys = { };
  keys["Z"]                     = function(e) { handleButton(e.pressed,  0); };  // eslint-disable-line
  keys[" "]                     = function(e) { handleButton(e.pressed,  0); };  // eslint-disable-line
  keys[String.fromCharCode(13)] = function(e) { handleButton(e.pressed,  0); };  // eslint-disable-line
  keys["X"]                     = function(e) { handleButton(e.pressed,  1); };  // eslint-disable-line
  keys[String.fromCharCode(27)] = function(e) { handleInvButton(e.pressed,  1); };  // eslint-disable-line
  input.setupKeys(keys);
  input.setupKeyboardDPadKeys(handleDPad, {
    pads: [
     { keys: input.kCursorKeys, },
     { keys: input.kASWDKeys,   },
    ],
  });

  // Setup the touch areas for buttons.
  touch.setupButtons({
    inputElement: $("buttons"),
    buttons: [
      { element: $("buttonA"), callback: function(e) { handleButton(e.pressed, 0); }, },  // eslint-disable-line
      { element: $("hft-menu"), callback: function(e) { handleInvButton(e.pressed, 1); }, },  // eslint-disable-line
    ],
  });

  // should I look this up? I can't actually know it until the CSS is set.
  touch.setupVirtualDPads({
    inputElement: $("dpads"),
    callback: handleDPad,
    fixedCenter: true,
    pads: [
      { referenceElement: $("dpad1"), },
    ],
  });

  handleOptions({
    controllerType: "1dpad-1button",
  });
});




define("main.js", function(){});

