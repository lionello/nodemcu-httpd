-- Small HTTP server for NodeMCU
--
-- PUT creates a new file in flash
-- GET returns the contents of a file in flash
-- DELETE remove the file from flash
-- POST executes the given lua script (may return a function that receives the payload)
--
-- TODO: need a way to return flash contents vs. index.html

return function (port)

  local s = net.createServer(net.TCP, 10) -- 10 seconds client timeout
  s:listen(
    port,
    function (connection)

      local function onReceive(connection, request)
        collectgarbage()
        local _, method, uri
        -- FIXME: skip query string
        _, _, method, uri = request:find("^([A-Z]+) /([^?]*).- HTTP/[1-9]+.[0-9]+\r\n")
        --r.uri = parseUri(r.request)
        --print("Method: "..method)
        --print("Uri: "..uri)

        if method == "PUT" and uri ~= "" then
          file.close()
          if not file.open("temp/put", "w") then
            connection:send("HTTP/1.1 500 Error\r\nConnection: close\r\n\r\nCreate error\n")
            connection:close()
          else
            -- Track Content-Length so we know when we're done
            local contentLength = tonumber(string.match(request, "\r\nContent%-Length: (%S+)\r\n"))

            local function done(connection)
              collectgarbage()
              file.close()
              if contentLength <= 0 then
                file.remove(uri)
                file.rename("temp/put", uri)
              else
                file.remove("temp/put")
              end
            end
            connection:on("disconnection", done)

            -- From now on, send everything to the file
            local function writeFile(connection, payload)
              collectgarbage()
              if file.write(payload) then
                contentLength = contentLength - #payload
                if contentLength <= 0 then
                  connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nSaved\n")
                  connection:close()
                end
              else
                connection:send("HTTP/1.1 500 Error\r\nConnection: close\r\n\r\nWrite error\n")
                connection:close()
              end
            end
            connection:on("receive", writeFile)

            if request:find("\r\nExpect: 100-continue\r\n", 1, true) then
              -- Send 100 Continue if the client expects it
              connection:send("HTTP/1.1 100 Continue\r\nConnection: close\r\n\r\n")
            else
              -- Find the start of the body (if any)
              local body_start = request:find("\r\n\r\n", 1, true) + 4
              writeFile(connection, request:sub(body_start))
            end
          end
        elseif method == "DELETE" then
          -- Delete the file from flash
          file.remove(uri)
          connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nDeleted\n")
          connection:close()
        elseif method == "POST" then
          if uri == "" then
            -- Reboot the device
            connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nRebooting\n")
            connection:close()
            node.restart()
          else
            -- Poor man's CGI
            local func = dofile(uri)
            if func then
              func(connection, request)
              connection:on("receive", func)
            else
              connection:send("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
              connection:close()
            end
          end
        elseif method == "GET" then
          if uri == "" then
            uri = "index.html"
          end
          -- Send the file contents to the client
          file.close()
          local headers = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n"
          --local encoding = request:find("\r\nAccept%-Encoding: gzip")
          if file.open(uri .. ".gz", "r") then
            headers = "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nConnection: close\r\n\r\n"
          elseif not file.open(uri, "r") then
            connection:send("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\nFile not found\n")
            connection:close()
          end
          local function onSent(connection)
            collectgarbage()
            local c = file.read(500)
            if c then
              connection:send(c)
            else
              file.close()
              connection:close()
            end
          end
          connection:on("sent", onSent)
          connection:send(headers)
        else
          connection:send("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n")
          connection:close()
        end
      end

      connection:on("receive", onReceive)

    end
  )

  -- false and nil evaluate as false
  local ip = wifi.sta.getip()
  if not ip then ip = wifi.ap.getip() end
  print("nodemcu-httpserver running at http://" .. ip .. ":" ..  port)
  return s

end
