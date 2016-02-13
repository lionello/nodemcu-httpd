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



