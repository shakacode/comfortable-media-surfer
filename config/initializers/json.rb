# frozen_string_literal: true

module JSON
module_function

  def parse(source, opts = {})
    opts = opts.dup
    opts.delete(:escape)
    Parser.new(source, **opts).parse
  end
end
