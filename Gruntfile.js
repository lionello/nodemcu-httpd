"use strict";

var fs      = require('fs');

var license = [
'/**                                                                                         ',
' * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.  ',
' * Available via the MIT or new BSD license.                                                ',
' * see: http://github.com/jrburke/almond for details                                        ',
' */                                                                                         ',
'',
].map(function(s) { return s.replace(/\s+$/, ''); }).join("\n");

module.exports = function(grunt) {

  grunt.initConfig({
    clean: [
      'conttroller/controller.min.js',
    ],
    requirejs: {
      full: {
        options: {
          baseUrl: "./controller/scripts",
          paths: {
            almond: "../../node_modules/almond/almond",
          },
          name: "almond",
          include: [ "main.js" ],
          out: "controller/controller.js",
          optimize: "none",
        },
      },
    },
    uglify: {
      min: {
        options: {
          mangle: true,
          //screwIE8: true,
          banner: license,
          compress: true,
        },
        files: {
          'controller/controller.min.js': ['controller/controller.js'],
        },
      },
    },
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-requirejs');

  grunt.registerTask('default', ['clean', 'requirejs', 'uglify']);
};

