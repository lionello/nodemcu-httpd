return function(connection, payload)
  connection:send("HTTP/1.0 200 OK\r\n\r\n")
  for k,v in pairs(file.list()) do
    connection:send(k .. "\t" .. v .. "\n")
  end
  connection:close()
end
